import path from 'node:path';
import { inspectProject, reviewProject } from './service.mjs';
import { summarizeReceipt } from './core/receipt.mjs';
import { RenderproveError } from './core/errors.mjs';
import { VERSION } from './version.mjs';

function write(stream, value) {
  stream.write(`${value}\n`);
}

function help() {
  return `Renderprove ${VERSION}\n\nUsage:\n  renderprove inspect [project] [--manifest path] [--json]\n  renderprove review [project] [--manifest path] [--output path] [--headed] [--json]\n  renderprove version\n\nRenderprove reads renderprove.json or .renderprove.json from the project directory.`;
}

export function parseArgs(argv) {
  const command = argv[0] ?? 'help';
  const options = { command, projectRoot: '.', json: false, headed: false };
  let positionalUsed = false;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--headed') options.headed = true;
    else if (arg === '--manifest' || arg === '--output') {
      const value = argv[index + 1];
      if (!value) throw new RenderproveError(`${arg} requires a value.`, { code: 'INVALID_ARGUMENT' });
      options[arg.slice(2)] = value;
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

export async function runCli(argv, { stdout, stderr, cwd }) {
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
    throw new RenderproveError(`Unknown command ${options.command}.`, { code: 'INVALID_ARGUMENT' });
  } catch (error) {
    const message = error instanceof RenderproveError ? error.message : 'Unexpected Renderprove failure.';
    write(stderr, `renderprove: ${message}`);
    if (process.env.RENDERPROVE_DEBUG && error?.stack) write(stderr, error.stack);
    return 2;
  }
}
