import { resolveProbePaths } from '../src/probe/enrollment.mjs';

try {
  const [toolRoot, project, output] = process.argv.slice(2);
  const paths = await resolveProbePaths({
    toolRoot,
    enrolledRoot: process.env.RENDERPROVE_ENROLLED_ROOT ?? toolRoot,
    project,
    output,
  });
  for (const value of [paths.enrolledRoot, paths.projectRoot, paths.evidenceRoot, paths.containerOutput]) {
    process.stdout.write(value);
    process.stdout.write('\0');
  }
} catch (error) {
  process.stderr.write(`probe-paths: ${error.message}\n`);
  if (process.env.RENDERPROVE_DEBUG && error?.stack) process.stderr.write(`${error.stack}\n`);
  process.exitCode = 2;
}
