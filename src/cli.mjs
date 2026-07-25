import path from 'node:path';
import { inspectProject, reviewProject } from './service.mjs';
import { adviseProject } from './advice/service.mjs';
import { summarizeReceipt } from './core/receipt.mjs';
import { RenderproveError } from './core/errors.mjs';
import { VERSION } from './version.mjs';

function write(stream, value) {
  stream.write(`${value}\n`);
}

function help() {
  return `Renderprove ${VERSION}\n\nUsage:\n  renderprove inspect [project] [--manifest path] [--json]\n  renderprove review [project] [--manifest path] [--output path] [--headed] [--json]\n  renderprove advise [project] [--manifest path] [--receipt path] [--include path] [--output path] [--model id] [--max-files n] [--max-bytes n] [--dry-run] [--json]\n  renderprove version\n\nRenderprove reads renderprove.json or .renderprove.json from the project directory.\n\nThe advise command is optional and non-authoritative. Live Cloudflare Workers AI calls require CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN. Use --dry-run to inspect the sanitized bundle without network access.`;
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
    } else if (['--manifest', '--output', '--receipt', '--model'].includes(arg)) {
      const value = argv[index + 1];
      if (!value) throw new RenderproveError(`${arg} requires a value.`, { code: 'INVALID_ARGUMENT' });
      options[arg.slice(2)] = value;
      index += 1;
    } else if (['--max-files', '--max-bytes', '--max-file-bytes', '--timeout'].includes(arg)) {
      const value = argv[index + 1];
      if (!value) throw new RenderproveError(`${arg} requires a value.`, { code: 'INVALID_ARGUMENT' });
      const limits = {
        '--max-files': { key: 'maxFiles', min: 1, max: 256 },
        '--max-bytes': { key: 'maxBytes', min: 1_024, max: 4_000_000 },
        '--max-file-bytes': { key: 'maxFileBytes', min: 1_024, max: 1_000_000 },
        '--timeout': { key: 'timeoutMs', min: 1_000, max: 120_000 },
      };
      const limit = limits[arg];
      options[limit.key] = parseInteger(value, arg, limit);
      index += 1;
    } else if (arg.startsWith('-')) {
      throw new RenderproveError(`Unknown option ${arg}.`, { code: 'INVALID_ARGUMENT' });
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
    if (options.command === 'advise') {
      if (options.headed) {
        throw new RenderproveError('--headed is only available for browser review.', { code: 'INVALID_ARGUMENT' });
      }
      const result = await adviseProject({
        projectRoot,
        manifestPath: options.manifest,
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
          write(stdout, `Redactions: ${result.bundle.summary.redactions}; omissions: ${result.bundle.summary.omissions}`);
          write(stdout, `SHA-256: ${result.bundle.sha256}`);
        }
        return 0;
      }
      if (options.json) write(stdout, JSON.stringify(result.advice, null, 2));
      else {
        write(stdout, `Advisory verdict: ${result.advice.verdict} (non-authoritative)`);
        write(stdout, result.advice.summary);
        write(stdout, `Findings: ${result.advice.findings.length}`);
        write(stdout, `Advice: ${path.relative(cwd, result.advicePath)}`);
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
