import { spawn } from 'node:child_process';
import path from 'node:path';
import { once } from 'node:events';
import { RenderproveError } from '../core/errors.mjs';

const MAX_LOG_BYTES = 256 * 1024;

function appendBounded(current, chunk) {
  const combined = current + chunk.toString('utf8');
  return combined.length <= MAX_LOG_BYTES ? combined : combined.slice(-MAX_LOG_BYTES);
}

async function waitForReady(url, { timeoutMs, signal, processExited }) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason;
    if (processExited()) {
      throw new RenderproveError('Preview process exited before it became ready.', { code: 'RUNTIME_EXITED' });
    }
    try {
      const response = await fetch(url, { redirect: 'manual', signal });
      if (response.status >= 200 && response.status < 400) return response.status;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new RenderproveError(`Preview did not become ready at ${url}.`, {
    code: 'RUNTIME_TIMEOUT',
    cause: lastError,
  });
}

export async function startRuntime(manifest, { signal } = {}) {
  const runtime = manifest.runtime;
  if (!runtime) {
    return {
      baseUrl: manifest.target.baseUrl,
      details: { mode: 'remote' },
      stop: async () => {},
    };
  }

  const [program, ...args] = runtime.command;
  const cwd = path.resolve(manifest.projectRoot, runtime.cwd);
  const child = spawn(program, args, {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      CI: process.env.CI,
      ...runtime.env,
      PORT: String(runtime.port),
      HOST: '127.0.0.1',
    },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });

  let stdout = '';
  let stderr = '';
  let exit = null;
  child.stdout.on('data', (chunk) => { stdout = appendBounded(stdout, chunk); });
  child.stderr.on('data', (chunk) => { stderr = appendBounded(stderr, chunk); });
  child.once('exit', (code, childSignal) => { exit = { code, signal: childSignal }; });
  child.once('error', (cause) => { exit = { error: cause }; });

  const baseUrl = `http://127.0.0.1:${runtime.port}`;
  try {
    await waitForReady(new URL(runtime.readyPath, `${baseUrl}/`).toString(), {
      timeoutMs: runtime.timeoutMs,
      signal,
      processExited: () => exit !== null,
    });
  } catch (error) {
    await terminate(child, runtime.shutdownMs);
    throw new RenderproveError(error.message, {
      code: error.code ?? 'RUNTIME_START_FAILED',
      cause: error,
      details: { stdout, stderr, exit },
    });
  }

  return {
    baseUrl,
    details: {
      mode: 'local',
      command: runtime.command,
      cwd,
      pid: child.pid,
    },
    logs: () => ({ stdout, stderr, exit }),
    stop: async () => terminate(child, runtime.shutdownMs),
  };
}

async function terminate(child, shutdownMs) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  await Promise.race([
    once(child, 'exit').catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, shutdownMs)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      if (process.platform === 'win32') child.kill('SIGKILL');
      else process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
}
