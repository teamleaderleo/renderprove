export const RECEIPT_SCHEMA = 'https://renderprove.com/schemas/receipt-v1.json';

export function createReceipt({ manifest, startedAt, finishedAt, baseUrl, cases, runtime }) {
  const failedCases = cases.filter((item) => item.status === 'failed').length;
  const diagnostics = cases.reduce((total, item) => total + item.diagnostics.length, 0);
  return {
    $schema: RECEIPT_SCHEMA,
    version: 1,
    project: manifest.project,
    source: {
      manifest: manifest.sourcePath,
      projectRoot: manifest.projectRoot,
    },
    target: { baseUrl },
    startedAt,
    finishedAt,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    status: failedCases === 0 ? 'passed' : 'failed',
    summary: {
      cases: cases.length,
      passed: cases.length - failedCases,
      failed: failedCases,
      diagnostics,
    },
    runtime,
    cases,
  };
}

export function summarizeReceipt(receipt) {
  return `${receipt.status.toUpperCase()}: ${receipt.summary.passed}/${receipt.summary.cases} browser cases passed; ${receipt.summary.diagnostics} diagnostics recorded.`;
}
