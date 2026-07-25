import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRepeatabilityReport } from '../src/probe/repeatability.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

function makeRun(name, { desktop = A, mobile = B, workerVersion = '123', receiptStatus = 'passed' } = {}) {
  return {
    name,
    worker: {
      version: 1,
      image: { id: 'sha256:image' },
      browser: { name: 'chromium', version: workerVersion },
      fonts: { count: 10, sha256: 'f'.repeat(64) },
    },
    receipt: {
      version: 1,
      status: receiptStatus,
      startedAt: `2026-01-01T00:00:0${name}.000Z`,
      finishedAt: `2026-01-01T00:00:1${name}.000Z`,
      cases: [
        {
          id: 'desktop:/',
          status: 'passed',
          route: { path: '/' },
          viewport: { name: 'desktop' },
          artifacts: [{ kind: 'screenshot', sha256: desktop }],
        },
        {
          id: 'mobile:/',
          status: 'passed',
          route: { path: '/' },
          viewport: { name: 'mobile' },
          artifacts: [{ kind: 'screenshot', sha256: mobile }],
        },
      ],
    },
  };
}

test('passes when worker identities and screenshots converge', () => {
  const report = buildRepeatabilityReport([makeRun('1'), makeRun('2'), makeRun('3')]);
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.summary, {
    runs: 3,
    cases: 2,
    stableCases: 2,
    driftingCases: 0,
    receiptsPassed: true,
    workerStable: true,
  });
  assert.equal(report.worker.sha256.length, 64);
  assert.equal(report.cases.every((item) => item.stable), true);
});

test('fails with explicit screenshot and worker drift observations', () => {
  const report = buildRepeatabilityReport([
    makeRun('1'),
    makeRun('2', { mobile: A, workerVersion: '124' }),
  ]);
  assert.equal(report.status, 'failed');
  assert.equal(report.summary.workerStable, false);
  assert.equal(report.summary.driftingCases, 1);
  assert.equal(report.cases.find((item) => item.id === 'mobile:/').screenshotSha256, null);
  assert.deepEqual(
    report.cases.find((item) => item.id === 'mobile:/').observations.map((item) => item.sha256),
    [B, A],
  );
});

test('fails when a receipt or case is missing', () => {
  const second = makeRun('2', { receiptStatus: 'failed' });
  second.receipt.cases.pop();
  const report = buildRepeatabilityReport([makeRun('1'), second]);
  assert.equal(report.status, 'failed');
  assert.equal(report.summary.receiptsPassed, false);
  assert.equal(report.cases.find((item) => item.id === 'mobile:/').observations[1].status, 'missing');
});

test('rejects invalid and ambiguous run collections', () => {
  assert.throws(() => buildRepeatabilityReport([makeRun('1')]), /at least two/);
  assert.throws(() => buildRepeatabilityReport([makeRun('1'), makeRun('1')]), /duplicate repeatability run name/);

  const empty = makeRun('2');
  empty.receipt.cases = [];
  assert.throws(() => buildRepeatabilityReport([makeRun('1'), empty]), /at least one case/);

  const duplicate = makeRun('2');
  duplicate.receipt.cases.push({ ...duplicate.receipt.cases[0] });
  assert.throws(() => buildRepeatabilityReport([makeRun('1'), duplicate]), /duplicate case id/);
});
