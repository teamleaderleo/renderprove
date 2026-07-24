export function shouldFail(diagnostic, failOn) {
  return Boolean({
    console: failOn.consoleError,
    page: failOn.pageError,
    request: failOn.requestFailure,
    http: failOn.httpError,
  }[diagnostic.kind]);
}

export function caseStatus(diagnostics, failOn) {
  return diagnostics.some((diagnostic) => shouldFail(diagnostic, failOn)) ? 'failed' : 'passed';
}
