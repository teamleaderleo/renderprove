import crypto from 'node:crypto';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function digestJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function screenshotDigest(reviewCase) {
  const artifact = reviewCase?.artifacts?.find((candidate) => candidate.kind === 'screenshot');
  return typeof artifact?.sha256 === 'string' && /^[a-f0-9]{64}$/.test(artifact.sha256)
    ? artifact.sha256
    : null;
}

function caseLocator(reviewCase) {
  if (!reviewCase) return { route: null, viewport: null };
  return {
    route: reviewCase.route?.path ?? null,
    viewport: reviewCase.viewport?.name ?? null,
  };
}

export function buildRepeatabilityReport(runs) {
  if (!Array.isArray(runs) || runs.length < 2) {
    throw new TypeError('repeatability requires at least two runs');
  }

  const names = new Set();
  for (const run of runs) {
    if (!run || typeof run.name !== 'string' || run.name.length === 0) {
      throw new TypeError('every repeatability run requires a name');
    }
    if (names.has(run.name)) throw new TypeError(`duplicate repeatability run name: ${run.name}`);
    names.add(run.name);
    if (!run.worker || !run.receipt) throw new TypeError(`run ${run.name} requires worker and receipt data`);
    if (!Array.isArray(run.receipt.cases)) throw new TypeError(`run ${run.name} receipt requires cases`);
  }

  const workerRuns = runs.map((run) => ({ run: run.name, sha256: digestJson(run.worker) }));
  const workerDigests = new Set(workerRuns.map((item) => item.sha256));
  const workerStable = workerDigests.size === 1;

  const caseIds = [...new Set(runs.flatMap((run) => run.receipt.cases.map((item) => item.id)))].sort();
  const cases = caseIds.map((id) => {
    const observations = runs.map((run) => {
      const reviewCase = run.receipt.cases.find((item) => item.id === id);
      return {
        run: run.name,
        status: reviewCase?.status ?? 'missing',
        sha256: screenshotDigest(reviewCase),
      };
    });
    const firstCase = runs.flatMap((run) => run.receipt.cases).find((item) => item.id === id);
    const screenshotDigests = new Set(observations.map((item) => item.sha256).filter(Boolean));
    const complete = observations.every((item) => item.status !== 'missing' && item.sha256 !== null);
    const passed = observations.every((item) => item.status === 'passed');
    const stable = complete && passed && screenshotDigests.size === 1;
    return {
      id,
      ...caseLocator(firstCase),
      stable,
      screenshotSha256: stable ? observations[0].sha256 : null,
      observations,
    };
  });

  const receiptsPassed = runs.every((run) => run.receipt.status === 'passed');
  const stableCases = cases.filter((item) => item.stable).length;
  const stable = receiptsPassed && workerStable && stableCases === cases.length;
  const startedAt = runs.map((run) => run.receipt.startedAt).filter(Boolean).sort()[0] ?? null;
  const finishedAtValues = runs.map((run) => run.receipt.finishedAt).filter(Boolean).sort();

  return {
    version: 1,
    status: stable ? 'passed' : 'failed',
    startedAt,
    finishedAt: finishedAtValues.at(-1) ?? null,
    summary: {
      runs: runs.length,
      cases: cases.length,
      stableCases,
      driftingCases: cases.length - stableCases,
      receiptsPassed,
      workerStable,
    },
    worker: {
      stable: workerStable,
      sha256: workerStable ? workerRuns[0].sha256 : null,
      observations: workerRuns,
    },
    runs: runs.map((run) => ({
      name: run.name,
      receiptStatus: run.receipt.status,
      cases: run.receipt.cases.length,
    })),
    cases,
  };
}
