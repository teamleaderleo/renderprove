import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { inspectProject, reviewProject } from '../service.mjs';
import { VERSION } from '../version.mjs';
import {
  resolveMcpManifest,
  resolveMcpProject,
  resolveOperatorRoot,
} from './projects.mjs';
import { ProjectReviewGate } from './review-gate.mjs';
import {
  sanitizeManifestForMcp,
  sanitizeReceiptForMcp,
  toolFailure,
  toolSuccess,
} from './results.mjs';

const projectInput = {
  project: z.string().min(1).max(4096).optional().describe('Project path beneath the operator-configured root. Defaults to the root itself.'),
  manifest: z.string().min(1).max(4096).optional().describe('Optional manifest path beneath the selected project.'),
};

function manifestSummary(manifest) {
  const cases = manifest.review.routes.length * manifest.review.viewports.length;
  return `${manifest.project}: ${cases} declared review case${cases === 1 ? '' : 's'}.`;
}

function receiptSummary(receipt) {
  return `${receipt.project}: ${receipt.summary.passed}/${receipt.summary.cases} cases passed with ${receipt.summary.diagnostics} diagnostics.`;
}

export async function createRenderproveMcpServer({
  root,
  inspect = inspectProject,
  review = reviewProject,
} = {}) {
  const operatorRoot = await resolveOperatorRoot(root);
  const reviewGate = new ProjectReviewGate();
  const server = new McpServer(
    { name: 'renderprove', version: VERSION },
    {
      instructions: [
        'Use inspect_project before review_project when configuration is unfamiliar.',
        'Projects and manifests must stay beneath the operator-configured root.',
        'review_project runs trusted repository code and may take longer than a normal tool call.',
        'The server returns bounded Renderprove evidence, not unrestricted browser control.',
      ].join(' '),
    },
  );

  server.registerTool(
    'inspect_project',
    {
      title: 'Inspect Renderprove project',
      description: 'Validate and summarize one enrolled Renderprove project without starting its runtime or browser.',
      inputSchema: projectInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ project = '.', manifest }) => {
      try {
        const resolved = await resolveMcpProject(operatorRoot, project);
        const manifestPath = await resolveMcpManifest(resolved.projectRoot, manifest);
        const normalized = await inspect({
          projectRoot: resolved.projectRoot,
          manifestPath,
        });
        return toolSuccess(
          sanitizeManifestForMcp(normalized, resolved.projectPath),
          manifestSummary(normalized),
        );
      } catch (error) {
        return toolFailure(error);
      }
    },
  );

  server.registerTool(
    'review_project',
    {
      title: 'Review Renderprove project',
      description: 'Run the declared Renderprove browser review for one enrolled trusted project and return its sanitized receipt.',
      inputSchema: projectInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ project = '.', manifest }) => {
      let releaseReview;
      try {
        const resolved = await resolveMcpProject(operatorRoot, project);
        const manifestPath = await resolveMcpManifest(resolved.projectRoot, manifest);
        releaseReview = reviewGate.claim(resolved.projectRoot);
        const { receipt } = await review({
          projectRoot: resolved.projectRoot,
          manifestPath,
          headed: false,
        });
        return toolSuccess(
          sanitizeReceiptForMcp(receipt, resolved.projectPath),
          receiptSummary(receipt),
        );
      } catch (error) {
        return toolFailure(error);
      } finally {
        releaseReview?.();
      }
    },
  );

  return { server, operatorRoot };
}

export async function startStdioMcp(options = {}) {
  const { server, operatorRoot } = await createRenderproveMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return { server, transport, operatorRoot };
}
