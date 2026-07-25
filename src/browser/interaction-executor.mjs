import { RenderproveError } from '../core/errors.mjs';
import { normalizeInteractionPlan } from './interaction-plan.mjs';

const PUBLIC_FAILURE_CODES = new Set([
  'INTERACTION_TIMEOUT',
  'INTERACTION_TARGET_UNAVAILABLE',
  'INTERACTION_VIEWPORT_UNAVAILABLE',
  'INTERACTION_CAPTURE_UNAVAILABLE',
  'INTERACTION_LOCATOR_UNSUPPORTED',
  'INTERACTION_STEP_UNSUPPORTED',
]);

function cancellationError(signal) {
  if (signal?.reason instanceof RenderproveError) return signal.reason;
  return new RenderproveError('Interaction plan was cancelled.', {
    code: 'INTERACTION_CANCELLED',
    cause: signal?.reason instanceof Error ? signal.reason : undefined,
  });
}

function timeoutError(label, timeoutMs) {
  return new RenderproveError(`${label} exceeded ${timeoutMs} ms.`, {
    code: 'INTERACTION_TIMEOUT',
    details: { timeoutMs },
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw cancellationError(signal);
}

function targetKind(target) {
  return target.space ? `${target.space}Point` : target.by;
}

function createLocator(page, target) {
  if (target.by === 'testId') return page.getByTestId(target.value);
  if (target.by === 'role') {
    const options = typeof target.name === 'string' ? { name: target.name, exact: target.exact } : {};
    return page.getByRole(target.role, options);
  }
  if (target.by === 'label') return page.getByLabel(target.value, { exact: target.exact });
  if (target.by === 'text') return page.getByText(target.value, { exact: target.exact });
  if (target.by === 'css') return page.locator(target.value);
  throw new RenderproveError(`Unsupported locator type ${target.by}.`, { code: 'INTERACTION_LOCATOR_UNSUPPORTED' });
}

function remainingMs(deadline, label, timeoutMs) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw timeoutError(label, timeoutMs);
  return remaining;
}

async function resolveLocatorPoint(page, target, xRatio, yRatio, timeoutMs, deadline = Date.now() + timeoutMs) {
  const locator = createLocator(page, target);
  await locator.waitFor({ state: 'visible', timeout: remainingMs(deadline, 'Interaction target resolution', timeoutMs) });
  await locator.scrollIntoViewIfNeeded({ timeout: remainingMs(deadline, 'Interaction target resolution', timeoutMs) });
  const box = await locator.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new RenderproveError('Interaction target does not have a visible bounding box.', {
      code: 'INTERACTION_TARGET_UNAVAILABLE',
    });
  }
  return {
    locator,
    point: {
      x: box.x + (box.width * xRatio),
      y: box.y + (box.height * yRatio),
    },
  };
}

async function resolvePoint(page, point, timeoutMs) {
  if (point.space === 'viewport') {
    const viewport = page.viewportSize();
    if (!viewport) {
      throw new RenderproveError('Viewport-relative interaction requires a fixed browser viewport.', {
        code: 'INTERACTION_VIEWPORT_UNAVAILABLE',
      });
    }
    return {
      locator: null,
      point: { x: viewport.width * point.x, y: viewport.height * point.y },
    };
  }
  return resolveLocatorPoint(page, point.target, point.x, point.y, timeoutMs);
}

async function raceWithAbortAndTimeout(operation, {
  signal,
  timeoutMs,
  label,
}) {
  throwIfAborted(signal);
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const aborted = new Promise((resolve, reject) => {
    combinedSignal.addEventListener('abort', () => {
      if (signal?.aborted) reject(cancellationError(signal));
      else reject(timeoutError(label, timeoutMs));
    }, { once: true });
  });
  return Promise.race([operation(combinedSignal), aborted]);
}

async function waitDuration(page, durationMs, signal) {
  if (durationMs <= 0) return;
  throwIfAborted(signal);
  let removeAbort = () => {};
  const aborted = new Promise((resolve, reject) => {
    if (!signal) return;
    const onAbort = () => reject(cancellationError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    removeAbort = () => signal.removeEventListener('abort', onAbort);
  });
  try {
    await Promise.race([page.waitForTimeout(durationMs), aborted]);
  } finally {
    removeAbort();
  }
  throwIfAborted(signal);
}

async function movePointer(page, pointerState, destination, { durationMs, steps }, signal) {
  throwIfAborted(signal);
  const stepCount = Math.max(1, steps);
  if (durationMs <= 0) {
    await page.mouse.move(destination.x, destination.y, { steps: stepCount });
    pointerState.x = destination.x;
    pointerState.y = destination.y;
    return;
  }
  const start = { x: pointerState.x, y: pointerState.y };
  const delayMs = durationMs / stepCount;
  for (let index = 1; index <= stepCount; index += 1) {
    throwIfAborted(signal);
    const progress = index / stepCount;
    const x = start.x + ((destination.x - start.x) * progress);
    const y = start.y + ((destination.y - start.y) * progress);
    await page.mouse.move(x, y);
    pointerState.x = x;
    pointerState.y = y;
    if (index < stepCount) await waitDuration(page, delayMs, signal);
  }
}

function stepResult(step, index, startedAt, details = {}) {
  const finishedAt = new Date().toISOString();
  return Object.freeze({
    index,
    id: step.id,
    type: step.type,
    status: 'passed',
    startedAt,
    finishedAt,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
    details: Object.freeze(details),
  });
}

function publicFailureCode(cause) {
  return PUBLIC_FAILURE_CODES.has(cause?.code) ? cause.code : 'INTERACTION_OPERATION_FAILED';
}

async function executeStep(page, step, pointerState, { capture, signal }) {
  throwIfAborted(signal);

  if (step.type === 'pointerMove') {
    const destination = await resolvePoint(page, step.to, step.timeoutMs);
    await movePointer(page, pointerState, destination.point, step, signal);
    return { to: targetKind(step.to), durationMs: step.durationMs, steps: step.steps };
  }

  if (step.type === 'click') {
    if (step.target.space) {
      const destination = await resolvePoint(page, step.target, step.timeoutMs);
      await page.mouse.click(destination.point.x, destination.point.y);
      pointerState.x = destination.point.x;
      pointerState.y = destination.point.y;
    } else {
      const deadline = Date.now() + step.timeoutMs;
      const destination = await resolveLocatorPoint(page, step.target, 0.5, 0.5, step.timeoutMs, deadline);
      await destination.locator.click({ timeout: remainingMs(deadline, 'Interaction click', step.timeoutMs) });
      pointerState.x = destination.point.x;
      pointerState.y = destination.point.y;
    }
    return { target: targetKind(step.target) };
  }

  if (step.type === 'drag') {
    const start = await resolvePoint(page, step.from, step.timeoutMs);
    const destination = await resolvePoint(page, step.to, step.timeoutMs);
    await page.mouse.move(start.point.x, start.point.y);
    pointerState.x = start.point.x;
    pointerState.y = start.point.y;
    await page.mouse.down({ button: 'left' });
    let released = false;
    try {
      await movePointer(page, pointerState, destination.point, step, signal);
      await page.mouse.up({ button: 'left' });
      released = true;
    } finally {
      if (!released) await page.mouse.up({ button: 'left' }).catch(() => {});
    }
    return {
      from: targetKind(step.from),
      to: targetKind(step.to),
      durationMs: step.durationMs,
      steps: step.steps,
    };
  }

  if (step.type === 'fill') {
    const locator = createLocator(page, step.target);
    if (step.mode === 'append') await locator.pressSequentially(step.text, { timeout: step.timeoutMs });
    else await locator.fill(step.text, { timeout: step.timeoutMs });
    return { target: step.target.by, mode: step.mode, textLength: step.text.length };
  }

  if (step.type === 'select') {
    const locator = createLocator(page, step.target);
    await locator.selectOption(step.values, { timeout: step.timeoutMs });
    return { target: step.target.by, valueCount: step.values.length };
  }

  if (step.type === 'waitFor') {
    const locator = createLocator(page, step.target);
    await locator.waitFor({ state: step.state, timeout: step.timeoutMs });
    return { target: step.target.by, state: step.state };
  }

  if (step.type === 'wait') {
    await waitDuration(page, step.durationMs, signal);
    return { durationMs: step.durationMs };
  }

  if (step.type === 'capture') {
    if (typeof capture !== 'function') {
      throw new RenderproveError('Interaction plan requested capture evidence without a capture handler.', {
        code: 'INTERACTION_CAPTURE_UNAVAILABLE',
      });
    }
    const locator = step.target ? createLocator(page, step.target) : null;
    await raceWithAbortAndTimeout(
      (captureSignal) => capture({
        page,
        locator,
        name: step.name,
        fullPage: step.fullPage,
        timeoutMs: step.timeoutMs,
        signal: captureSignal,
      }),
      { signal, timeoutMs: step.timeoutMs, label: `Capture ${step.name}` },
    );
    return { name: step.name, target: step.target?.by ?? 'page', fullPage: step.fullPage };
  }

  throw new RenderproveError(`Unsupported interaction step ${step.type}.`, {
    code: 'INTERACTION_STEP_UNSUPPORTED',
  });
}

export async function runInteractionPlan(page, input, {
  capture,
  signal,
  onStep,
} = {}) {
  const plan = normalizeInteractionPlan(input);
  const pointerState = { x: 0, y: 0 };
  const results = [];
  const startedAt = new Date().toISOString();

  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index];
    const stepStartedAt = new Date().toISOString();
    try {
      const details = await executeStep(page, step, pointerState, { capture, signal });
      throwIfAborted(signal);
      const result = stepResult(step, index, stepStartedAt, details);
      results.push(result);
      await onStep?.(result);
    } catch (cause) {
      if (cause?.code === 'INTERACTION_CANCELLED' || signal?.aborted) throw cancellationError(signal);
      throw new RenderproveError(`Interaction step ${step.id} failed.`, {
        code: 'INTERACTION_STEP_FAILED',
        details: {
          plan: plan.name,
          stepId: step.id,
          stepType: step.type,
          stepIndex: index,
          completedSteps: results.length,
          failureCode: publicFailureCode(cause),
        },
      });
    }
  }

  const finishedAt = new Date().toISOString();
  return Object.freeze({
    version: 1,
    plan: plan.name,
    status: 'passed',
    startedAt,
    finishedAt,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
    declaredBudgetMs: plan.declaredBudgetMs,
    steps: Object.freeze(results),
  });
}
