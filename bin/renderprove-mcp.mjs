#!/usr/bin/env node
import { runMcpCli } from '../src/mcp/cli.mjs';

const exitCode = await runMcpCli(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: process.stdout,
  stderr: process.stderr,
});

process.exitCode = exitCode;
