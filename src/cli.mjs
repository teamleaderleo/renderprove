import path from 'node:path';
import { inspectProject, reviewProject } from './service.mjs';
import { adviseProject } from './advice/service.mjs';
import { comparePngFiles, summarizeVisualComparison } from './visual/comparison.mjs';
import { summarizeReceipt } from './core/receipt.mjs';
import { RenderproveError } from './core/errors.mjs';
import { buildVisionRequest, summarizeVisionPreview } from './vision/request.mjs';
import { VERSION } from './version.mjs';

function write(stream, value) {
  stream.write(`${value}\n`);
}

function help() {
  return `Renderprove ${VERSION}\n\nUsage:\n  renderprove inspect [project] [--manifest path] [--json]\n  renderprove review [project] [--manifest path] [--output path] [--headed] [--json]\n  renderprove compare <reference.png> <candidate.png> [--output path] [--max-p99-delta-e n] [--max-obvious-fraction n] [--max-alpha-error n] [--max-panel-edge n] [--json]\n  renderprove advise [project] [--manifest path] [--advice-config path] [--receipt path] [--include path] [--output path] [--model id] [--max-files n] [--max-bytes n] [--dry-run] [--json]\n  renderprove vision-check [project] --screenshot path --brief path [--receipt path] --dry-run [--json]\n  renderprove version\n\nRenderprove reads renderprove.json or .renderprove.json from the project directory. Advisory policy is read from renderprove-advice.json or .renderprove-advice.json when present.\n\nThe compare command writes deterministic CIE76 metrics, a full-resolution Delta-E heatmap, and a reference/candidate/difference triptych. It is separate from receipt v1.\n\nThe advise command is optional and non-authoritative. Live Cloudflare Workers AI calls require CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN. Use --dry-run to inspect the sanitized bundle, review questions, exclusions, and estimated Neuron use without network access.\n\nThe vision-check command is a separate sparse screenshot advisory contract. This slice requires --dry-run, accepts one explicit PNG and brief plus an optional matching receipt, and performs no provider call.`;
}

function parseInteger(value, option, { min, max }) {
  if (!/^[0-9]+$/.test(value ?? '')) {
    throw new RenderproveError(`${option} requires an integer.`, { code: 'INVALID_ARGUMENT' });
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new RenderproveError(`${option} must be between ${min} and ${max}.`, { code: 'INVALID_ARGUMENT' });
  }
  return parsed;
}

function parseNumber(value, option, { min, max }) {
  if (value == null || value.trim() === '') {
    throw new RenderproveError(`${option} requires a number.`, { code: 'INVALID_ARGUMENT' });
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new RenderproveError(`${option} must be between ${min} and ${max}.`, { code: 'INVALID_ARGUMENT' });
  }
  return parsed;
}

export function parseArgs(argv) {
  const command = argv[0] ?? 'help';
  const options = { command, projectRoot: '.', json: false, headed: false };
  let positionalUsed = false;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--headed') options.headed = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--include') {
      const value = argv[index + 1];
      if (!value) throw new RenderproveError('--include requires a value.', { code: 'INVALID_ARGUMENT' });
      options.includePaths ??= [];
      options.includePaths.push(value);
      index += 1;
    } else if (['--manifest', '--advice-config', '--output', '--receipt', '--model', '--screenshot', '--brief'].includes(arg)) {
      const value = argv[index + 1];
      if (!value) throw new RenderproveError(`${arg} requires a value.`, { code: 'INVALID_ARGUMENT' });
      const keys = {
        '--manifest': 'manifest',
        '--advice-config': 'adviceConfig',
        '--output': 'output',
        '--receipt': 'receipt',
        '--model': 'model',
        '--screenshot': 'screenshot',
        '--brief': 'brief',
      };
      const key = keys[arg];
      if (command === 'vision-check' && options[key] != null) {
        throw new RenderproveError(`${arg} may be provided only once.`, { code: 'INVALID_ARGUMENT' });
      }
      options[key] = value;
      index += 1;
    } else if (['--max-files', '--max-bytes', '--max-file-bytes', '--timeout', '--max-alpha-error', '--max-panel-edge'].includes(arg)) {
      const value = argv[index + 1];
      if (!value) throw new RenderproveError(`${arg} requires a value.`, { code: 'INVALID_ARGUMENT' });
      const limits = {
        '--max-files': { key: 'maxFiles', min: 1, max: 256 },
        '--max-bytes': { key: 'maxBytes', min: 1_024, max: 4_000_000 },
        '--max-file-bytes': { key: 'maxFileBytes', min: 1_024, max: 1_000_000 },
        '--timeout': { key: 'timeoutMs', min: 1_000, max: 120_000 },
        '--max-alpha-error': { key: 'maxAlphaError', min: 0, max: 255 },
        '--max-panel-edge': { key: 'maxPanelEdge', min: 32, max: 4_096 },
      };
      const limit = limits[arg];
      options[limit.key] = parseInteger(value, arg, limit);
      index += 1;
    } else if (['--max-p99-delta-e', '--max-obvious-fraction'].includes(arg)) {
      const value = argv[index + 1];
      const limits = {
        '--max-p99-delta-e': { key: 'maxP99DeltaE', min: 0, max: 200 },
        '--max-obvious-fraction': { key: 'maxObviousFraction', min: 0, max: 1 },
      };
      const limit = limits[arg];
      options[limit.key] = parseNumber(value, arg, limit);
      index += 1;
    } else if (arg.startsWith('-')) {
      throw new RenderproveError(`Unknown option ${arg}.`, { code: 'INVALID_ARGUMENT' });
    } else if (command === 'compare' && options.referencePath == null) {
      options.referencePath = arg;
    } else if (command === 'compare' && options.candidatePath == null) {
      options.candidatePath = arg;
    } else if (command === 'compare') {
      throw new RenderproveError(`Unexpected argument ${arg}.`, { code: 'INVALID_ARGUMENT' });
    } else if (!positionalUsed) {
      options.projectRoot = arg;
      positionalUsed = true;
    } else {
      throw new RenderproveError(`Unexpected argument ${arg}.`, { code: 'INVALID_ARGUMENT' });
    }
  }
  return options;
}

export async function runCli(argv, { stdout, stderr, cwd, env = process.env }) {
  try {
    const options = parseArgs(argv);
    const projectRoot = path.resolve(cwd, options.projectRoot);
    if (options.command === 'help' || options.command === '--help' || options.command === '-h') {
      write(stdout, help());
      return 0;
    }
    if (options.command === 'version' || options.command === '--version' || options.command === '-v') {
      write(stdout, VERSION);
      return 0;
    }
    if (options.command === 'compare') {
      const disallowed = [
        'headed', 'dryRun', 'includePaths', 'manifest', 'adviceConfig', 'receipt', 'model',
        'screenshot', 'brief', 'maxFiles', 'maxBytes', 'maxFileBytes', 'timeoutMs',
      ].filter((key) => options[key] != null && options[key] !== false);
      if (disallowed.length > 0) {
        throw new RenderproveError('Browser and advisory options are unavailable for visual comparison.', {
          code: 'INVALID_ARGUMENT',
          details: { disallowed },
        });
      }
      const comparison = await comparePngFiles({
        referencePath: options.referencePath,
        candidatePath: options.candidatePath,
        outputDir: options.output,
        cwd,
        maxPanelEdge: options.maxPanelEdge,
        thresholds: {
          maxP99DeltaE: options.maxP99DeltaE,
          maxObviousFraction: options.maxObviousFraction,
          maxAlphaError: options.maxAlphaError,
        },
      });
      if (options.json) write(stdout, JSON.stringify(comparison.result, null, 2));
      else {
        write(stdout, summarizeVisualComparison(comparison.result));
        write(stdout, `Result: ${path.relative(cwd, comparison.resultPath)}`);
        write(stdout, `Comparison: ${path.relative(cwd, comparison.comparisonPath)}`);
        write(stdout, `Difference: ${path.relative(cwd, comparison.differencePath)}`);
      }
      return comparison.result.status === 'passed' ? 0 : 1;
    }
    if (options.command === 'inspect') {
      const manifest = await inspectProject({ projectRoot, manifestPath: options.manifest });
      if (options.json) write(stdout, JSON.stringify(manifest, null, 2));
      else {
        write(stdout, `Project: ${manifest.project}`);
        write(stdout, `Mode: ${manifest.runtime ? 'local runtime' : 'deployed URL'}`);
        write(stdout, `Cases: ${manifest.review.routes.length * manifest.review.viewports.length}`);
      }
      return 0;
    }
    if (options.command === 'review') {
      const { receipt, receiptPath } = await reviewProject({
        projectRoot,
        manifestPath: options.manifest,
        outputDir: options.output,
        headed: options.headed,
      });
      if (options.json) write(stdout, JSON.stringify(receipt, null, 2));
      else {
        write(stdout, summarizeReceipt(receipt));
        write(stdout, `Receipt: ${path.relative(cwd, receiptPath)}`);
      }
      return receipt.status === 'passed' ? 0 : 1;
    }
    if (options.command === 'vision-check') {
      const disallowed = [
        'headed', 'includePaths', 'manifest', 'adviceConfig', 'output', 'model',
        'maxFiles', 'maxBytes', 'maxFileBytes', 'timeoutMs', 'maxP99DeltaE',
        'maxObviousFraction', 'maxAlphaError', 'maxPanelEdge',
      ].filter((key) => options[key] != null && options[key] !== false);
      if (disallowed.length > 0) {
        throw new RenderproveError('vision-check accepts only one screenshot, one brief, an optional receipt, --dry-run, and --json.', {
          code: 'INVALID_ARGUMENT',
          details: { disallowed },
        });
      }
      if (!options.dryRun) {
        throw new RenderproveError('vision-check currently requires --dry-run; provider execution is outside this slice.', {
          code: 'INVALID_ARGUMENT',
        });
      }
      if (!options.screenshot || !options.brief) {
        throw new RenderproveError('vision-check requires --screenshot and --brief.', { code: 'INVALID_ARGUMENT' });
      }
      const result = await buildVisionRequest({
        projectRoot,
        screenshotPath: options.screenshot,
        briefPath: options.brief,
        receiptPath: options.receipt,
      });
      if (options.json) write(stdout, JSON.stringify(result.preview, null, 2));
      else write(stdout, summarizeVisionPreview(result.preview));
      return 0;
    }
    if (options.command === 'advise') {
      if (options.headed) {
        throw new RenderproveError('--headed is only available for browser review.', { code: 'INVALID_ARGUMENT' });
      }
      const result = await adviseProject({
        projectRoot,
        manifestPath: options.manifest,
        adviceConfigPath: options.adviceConfig,
        receiptPath: options.receipt,
        outputDir: options.output,
        includePaths: options.includePaths,
        maxFiles: options.maxFiles,
        maxBytes: options.maxBytes,
        maxFileBytes: options.maxFileBytes,
        model: options.model ?? env.RENDERPROVE_AI_MODEL,
        timeoutMs: options.timeoutMs,
        dryRun: options.dryRun,
        accountId: env.CLOUDFLARE_ACCOUNT_ID,
        apiToken: env.CLOUDFLARE_API_TOKEN ?? env.CLOUDFLARE_AUTH_TOKEN,
      });
      if (options.dryRun) {
        if (options.json) write(stdout, JSON.stringify(result.bundle, null, 2));
        else {
          write(stdout, `Advisory bundle: ${result.bundle.summary.files} files, ${result.bundle.summary.bytes} bytes`);
          write(stdout, `Mode: ${result.bundle.mode}; questions: ${result.bundle.reviewQuestions.length}`);
          write(stdout, `Redactions: ${result.bundle.summary.redactions}; omissions: ${result.bundle.summary.omissions}`);
          write(stdout, `Estimated use: ${result.budget.estimatedNeurons} Neurons (per-run ceiling ${result.budget.maxEstimatedNeurons}; daily guide ${result.budget.dailyNeurons})`);
          write(stdout, `SHA-256: ${result.bundle.sha256}`);
        }
        return 0;
      }
      if (!result.advice) {
        if (options.json) write(stdout, JSON.stringify(result.status, null, 2));
        else {
          write(stdout, `Advisory status: ${result.status.status}`);
          write(stdout, `Reason: ${result.status.reason}`);
          write(stdout, `Estimated use: ${result.budget.estimatedNeurons} Neurons; ceiling: ${result.budget.maxEstimatedNeurons}`);
          if (result.budget.contact) write(stdout, `Budget contact: ${result.budget.contact}`);
          write(stdout, `Status: ${path.relative(cwd, result.statusPath)}`);
        }
        return 0;
      }
      if (options.json) write(stdout, JSON.stringify(result.advice, null, 2));
      else {
        write(stdout, `Advisory verdict: ${result.advice.verdict} (non-authoritative${result.reused ? ', reused' : ''})`);
        write(stdout, result.advice.summary);
        write(stdout, `Findings: ${result.advice.findings.length}`);
        write(stdout, `Estimated use: ${result.budget.estimatedNeurons} Neurons; reported total tokens: ${result.advice.usage?.total_tokens ?? 'unknown'}`);
        write(stdout, `Advice: ${path.relative(cwd, result.advicePath)}`);
        write(stdout, `Status: ${path.relative(cwd, result.statusPath)}`);
      }
      return 0;
    }
    throw new RenderproveError(`Unknown command ${options.command}.`, { code: 'INVALID_ARGUMENT' });
  } catch (error) {
    const message = error instanceof RenderproveError ? error.message : 'Unexpected Renderprove failure.';
    write(stderr, `renderprove: ${message}`);
    if (process.env.RENDERPROVE_DEBUG && error?.stack) write(stderr, error.stack);
    return 2;
  }
}
