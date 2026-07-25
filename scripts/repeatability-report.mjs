import fs from 'node:fs/promises';
import path from 'node:path';
import { buildRepeatabilityReport } from '../src/probe/repeatability.mjs';

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function main() {
  const root = path.resolve(process.cwd(), process.argv[2] ?? 'tests/fixtures/site/.renderprove-repeatability');
  const runsRoot = path.join(root, 'runs');
  const entries = (await fs.readdir(runsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const runs = await Promise.all(entries.map(async (name) => {
    const runRoot = path.join(runsRoot, name);
    return {
      name,
      worker: await readJson(path.join(runRoot, 'worker.json')),
      receipt: await readJson(path.join(runRoot, 'receipt.json')),
    };
  }));

  const report = buildRepeatabilityReport(runs);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'passed') process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`repeatability-report: ${error.message}\n`);
  if (process.env.RENDERPROVE_DEBUG && error?.stack) process.stderr.write(`${error.stack}\n`);
  process.exitCode = 2;
}
