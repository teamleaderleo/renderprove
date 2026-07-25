import path from 'node:path';
import { RenderproveError } from '../core/errors.mjs';
import { VERSION } from '../version.mjs';
import { startStdioMcp } from './server.mjs';

function write(stream, value) {
  stream.write(`${value}\n`);
}

function help() {
  return `Renderprove MCP ${VERSION}\n\nUsage:\n  renderprove-mcp --root <directory>\n  renderprove-mcp --help\n  renderprove-mcp --version\n\nThe root is selected by the operator. MCP tool arguments may only select projects beneath it.`;
}

export function parseMcpArgs(argv) {
  const options = { root: null, help: false, version: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--version' || arg === '-v') options.version = true;
    else if (arg === '--root') {
      const value = argv[index + 1];
      if (!value) throw new RenderproveError('--root requires a directory.', { code: 'INVALID_ARGUMENT' });
      options.root = value;
      index += 1;
    } else {
      throw new RenderproveError(`Unknown option ${arg}.`, { code: 'INVALID_ARGUMENT' });
    }
  }
  if (!options.help && !options.version && !options.root) {
    throw new RenderproveError('--root is required.', { code: 'INVALID_ARGUMENT' });
  }
  return options;
}

export async function runMcpCli(argv, { cwd = process.cwd(), stdout, stderr, start = startStdioMcp } = {}) {
  try {
    const options = parseMcpArgs(argv);
    if (options.help) {
      write(stdout, help());
      return 0;
    }
    if (options.version) {
      write(stdout, VERSION);
      return 0;
    }
    await start({ root: path.resolve(cwd, options.root) });
    return 0;
  } catch (error) {
    write(stderr, `renderprove-mcp: ${error instanceof Error ? error.message : 'Unexpected failure.'}`);
    if (process.env.RENDERPROVE_DEBUG && error?.stack) write(stderr, error.stack);
    return 2;
  }
}
