import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const execFileAsync = promisify(execFile);

function parseOsRelease(text) {
  const result = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].replace(/^"|"$/g, '').replace(/\\"/g, '"');
    result[match[1]] = value;
  }
  return result;
}

async function readJson(url) {
  return JSON.parse(await fs.readFile(url, 'utf8'));
}

async function collectFontIdentity() {
  try {
    const { stdout } = await execFileAsync('fc-list', ['--format', '%{file}\t%{family}\t%{style}\n'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    const entries = stdout.split('\n').map((line) => line.trim()).filter(Boolean).sort();
    return {
      count: entries.length,
      sha256: crypto.createHash('sha256').update(`${entries.join('\n')}\n`).digest('hex'),
    };
  } catch {
    return { count: null, sha256: null };
  }
}

const packageJson = await readJson(new URL('../package.json', import.meta.url));
const osRelease = parseOsRelease(await fs.readFile('/etc/os-release', 'utf8'));
const fonts = await collectFontIdentity();
const browser = await chromium.launch({ headless: true });
let browserVersion;
try {
  browserVersion = browser.version();
} finally {
  await browser.close();
}

const identity = {
  version: 1,
  image: {
    reference: process.env.RENDERPROVE_WORKER_IMAGE ?? null,
    id: process.env.RENDERPROVE_WORKER_IMAGE_ID ?? null,
    digest: process.env.RENDERPROVE_WORKER_IMAGE_DIGEST ?? null,
  },
  renderprove: {
    version: packageJson.version,
    playwrightVersion: packageJson.dependencies?.playwright ?? null,
  },
  platform: {
    os: osRelease.ID ?? process.platform,
    osVersion: osRelease.VERSION_ID ?? os.release(),
    architecture: process.arch,
    kernel: os.release(),
    node: process.version,
  },
  browser: {
    name: 'chromium',
    version: browserVersion,
  },
  environment: {
    locale: process.env.LANG ?? null,
    timezone: process.env.TZ ?? null,
  },
  fonts,
};

process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`);
