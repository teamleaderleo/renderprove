import { RenderproveError } from '../core/errors.mjs';

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_PLAN_BUDGET_MS = 120_000;
const MAX_STEPS = 100;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const LOCATOR_VALUE_MAX = 512;

function fail(message, details) {
  throw new RenderproveError(message, { code: 'INVALID_INTERACTION_PLAN', details });
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}

function assertKnownKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) fail(`${label} contains unknown fields: ${unknown.join(', ')}.`, { unknown });
}

function normalizeId(value, label) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    fail(`${label} must start with an alphanumeric character and contain at most 80 letters, numbers, dots, underscores, or hyphens.`);
  }
  return value;
}

function normalizeString(value, label, { min = 1, max = LOCATOR_VALUE_MAX } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    fail(`${label} must be a string between ${min} and ${max} characters.`);
  }
  return value;
}

function normalizeInteger(value, fallback, label, { min, max }) {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate < min || candidate > max) {
    fail(`${label} must be an integer between ${min} and ${max}.`);
  }
  return candidate;
}

function normalizeRatio(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(`${label} must be a finite number between 0 and 1.`);
  }
  return value;
}

function normalizeExact(value, label) {
  if (typeof value !== 'undefined' && typeof value !== 'boolean') fail(`${label} must be a boolean.`);
  return value ?? true;
}

export function normalizeInteractionLocator(input, label = 'locator') {
  const value = assertObject(input, label);
  if (value.by === 'testId') {
    assertKnownKeys(value, ['by', 'value'], label);
    return Object.freeze({ by: 'testId', value: normalizeString(value.value, `${label}.value`) });
  }
  if (value.by === 'role') {
    assertKnownKeys(value, ['by', 'role', 'name', 'exact'], label);
    const locator = {
      by: 'role',
      role: normalizeString(value.role, `${label}.role`, { max: 64 }),
      exact: normalizeExact(value.exact, `${label}.exact`),
    };
    if (typeof value.name !== 'undefined') locator.name = normalizeString(value.name, `${label}.name`);
    return Object.freeze(locator);
  }
  if (value.by === 'label' || value.by === 'text') {
    assertKnownKeys(value, ['by', 'value', 'exact'], label);
    return Object.freeze({
      by: value.by,
      value: normalizeString(value.value, `${label}.value`),
      exact: normalizeExact(value.exact, `${label}.exact`),
    });
  }
  if (value.by === 'css') {
    assertKnownKeys(value, ['by', 'value'], label);
    return Object.freeze({ by: 'css', value: normalizeString(value.value, `${label}.value`) });
  }
  fail(`${label}.by must be one of testId, role, label, text, or css.`);
}

export function normalizeInteractionPoint(input, label = 'point') {
  const value = assertObject(input, label);
  if (value.space === 'viewport') {
    assertKnownKeys(value, ['space', 'x', 'y'], label);
    return Object.freeze({
      space: 'viewport',
      x: normalizeRatio(value.x, `${label}.x`),
      y: normalizeRatio(value.y, `${label}.y`),
    });
  }
  if (value.space === 'target') {
    assertKnownKeys(value, ['space', 'target', 'x', 'y'], label);
    return Object.freeze({
      space: 'target',
      target: normalizeInteractionLocator(value.target, `${label}.target`),
      x: normalizeRatio(value.x, `${label}.x`),
      y: normalizeRatio(value.y, `${label}.y`),
    });
  }
  fail(`${label}.space must be viewport or target.`);
}

function normalizeTarget(input, label) {
  const value = assertObject(input, label);
  return 'space' in value
    ? normalizeInteractionPoint(value, label)
    : normalizeInteractionLocator(value, label);
}

function movementDefaults(durationMs, explicitSteps) {
  const steps = explicitSteps ?? Math.max(1, Math.min(120, Math.ceil(durationMs / 16)));
  return { durationMs, steps };
}

function normalizeTimeout(value, fallback, label) {
  return normalizeInteger(value, fallback, label, { min: 100, max: 30_000 });
}

function normalizeStep(input, index, defaultTimeoutMs) {
  const label = `steps[${index}]`;
  const value = assertObject(input, label);
  const id = normalizeId(value.id, `${label}.id`);

  if (value.type === 'pointerMove') {
    assertKnownKeys(value, ['id', 'type', 'to', 'durationMs', 'steps', 'timeoutMs'], label);
    const durationMs = normalizeInteger(value.durationMs, 0, `${label}.durationMs`, { min: 0, max: 5_000 });
    const movement = movementDefaults(durationMs, value.steps);
    movement.steps = normalizeInteger(movement.steps, undefined, `${label}.steps`, { min: 1, max: 120 });
    return Object.freeze({
      id,
      type: 'pointerMove',
      to: normalizeInteractionPoint(value.to, `${label}.to`),
      timeoutMs: normalizeTimeout(value.timeoutMs, defaultTimeoutMs, `${label}.timeoutMs`),
      ...movement,
    });
  }

  if (value.type === 'click') {
    assertKnownKeys(value, ['id', 'type', 'target', 'timeoutMs'], label);
    return Object.freeze({
      id,
      type: 'click',
      target: normalizeTarget(value.target, `${label}.target`),
      timeoutMs: normalizeTimeout(value.timeoutMs, defaultTimeoutMs, `${label}.timeoutMs`),
    });
  }

  if (value.type === 'drag') {
    assertKnownKeys(value, ['id', 'type', 'from', 'to', 'durationMs', 'steps', 'timeoutMs'], label);
    const durationMs = normalizeInteger(value.durationMs, 250, `${label}.durationMs`, { min: 0, max: 5_000 });
    const movement = movementDefaults(durationMs, value.steps);
    movement.steps = normalizeInteger(movement.steps, undefined, `${label}.steps`, { min: 1, max: 120 });
    return Object.freeze({
      id,
      type: 'drag',
      from: normalizeInteractionPoint(value.from, `${label}.from`),
      to: normalizeInteractionPoint(value.to, `${label}.to`),
      timeoutMs: normalizeTimeout(value.timeoutMs, defaultTimeoutMs, `${label}.timeoutMs`),
      ...movement,
    });
  }

  if (value.type === 'fill') {
    assertKnownKeys(value, ['id', 'type', 'target', 'text', 'mode', 'timeoutMs'], label);
    const mode = value.mode ?? 'replace';
    if (!['replace', 'append'].includes(mode)) fail(`${label}.mode must be replace or append.`);
    return Object.freeze({
      id,
      type: 'fill',
      target: normalizeInteractionLocator(value.target, `${label}.target`),
      text: normalizeString(value.text, `${label}.text`, { min: 0, max: 10_000 }),
      mode,
      timeoutMs: normalizeTimeout(value.timeoutMs, defaultTimeoutMs, `${label}.timeoutMs`),
    });
  }

  if (value.type === 'select') {
    assertKnownKeys(value, ['id', 'type', 'target', 'values', 'timeoutMs'], label);
    if (!Array.isArray(value.values) || value.values.length < 1 || value.values.length > 20) {
      fail(`${label}.values must contain between 1 and 20 strings.`);
    }
    const values = value.values.map((item, valueIndex) => normalizeString(item, `${label}.values[${valueIndex}]`));
    if (new Set(values).size !== values.length) fail(`${label}.values must be unique.`);
    return Object.freeze({
      id,
      type: 'select',
      target: normalizeInteractionLocator(value.target, `${label}.target`),
      values: Object.freeze(values),
      timeoutMs: normalizeTimeout(value.timeoutMs, defaultTimeoutMs, `${label}.timeoutMs`),
    });
  }

  if (value.type === 'waitFor') {
    assertKnownKeys(value, ['id', 'type', 'target', 'state', 'timeoutMs'], label);
    if (!['attached', 'detached', 'visible', 'hidden'].includes(value.state)) {
      fail(`${label}.state must be attached, detached, visible, or hidden.`);
    }
    return Object.freeze({
      id,
      type: 'waitFor',
      target: normalizeInteractionLocator(value.target, `${label}.target`),
      state: value.state,
      timeoutMs: normalizeTimeout(value.timeoutMs, defaultTimeoutMs, `${label}.timeoutMs`),
    });
  }

  if (value.type === 'wait') {
    assertKnownKeys(value, ['id', 'type', 'durationMs'], label);
    return Object.freeze({
      id,
      type: 'wait',
      durationMs: normalizeInteger(value.durationMs, undefined, `${label}.durationMs`, { min: 0, max: 5_000 }),
    });
  }

  if (value.type === 'capture') {
    assertKnownKeys(value, ['id', 'type', 'name', 'fullPage', 'target', 'timeoutMs'], label);
    if (typeof value.fullPage !== 'undefined' && typeof value.fullPage !== 'boolean') fail(`${label}.fullPage must be a boolean.`);
    const step = {
      id,
      type: 'capture',
      name: normalizeId(value.name, `${label}.name`),
      fullPage: value.fullPage ?? true,
      timeoutMs: normalizeTimeout(value.timeoutMs, defaultTimeoutMs, `${label}.timeoutMs`),
    };
    if (typeof value.target !== 'undefined') step.target = normalizeInteractionLocator(value.target, `${label}.target`);
    return Object.freeze(step);
  }

  fail(`${label}.type is unsupported.`);
}

function pointResolutionBudget(point, timeoutMs) {
  return point?.space === 'target' ? timeoutMs : 0;
}

function targetResolutionBudget(target, timeoutMs) {
  if (!target) return 0;
  return target.space ? pointResolutionBudget(target, timeoutMs) : timeoutMs;
}

function stepBudgetMs(step) {
  if (step.type === 'wait') return step.durationMs;
  if (step.type === 'pointerMove') return step.durationMs + pointResolutionBudget(step.to, step.timeoutMs);
  if (step.type === 'drag') {
    return step.durationMs
      + pointResolutionBudget(step.from, step.timeoutMs)
      + pointResolutionBudget(step.to, step.timeoutMs);
  }
  if (step.type === 'click') return targetResolutionBudget(step.target, step.timeoutMs);
  return step.timeoutMs;
}

export function normalizeInteractionPlan(input) {
  const value = assertObject(input, 'interaction plan');
  assertKnownKeys(value, ['$schema', 'version', 'name', 'defaults', 'steps'], 'interaction plan');
  if (value.version !== 1) fail('interaction plan.version must be 1.');
  const defaults = value.defaults ?? {};
  assertObject(defaults, 'interaction plan.defaults');
  assertKnownKeys(defaults, ['timeoutMs'], 'interaction plan.defaults');
  const timeoutMs = normalizeTimeout(defaults.timeoutMs, DEFAULT_TIMEOUT_MS, 'interaction plan.defaults.timeoutMs');
  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > MAX_STEPS) {
    fail(`interaction plan.steps must contain between 1 and ${MAX_STEPS} steps.`);
  }
  const steps = value.steps.map((step, index) => normalizeStep(step, index, timeoutMs));
  const duplicateId = steps.find((step, index) => steps.findIndex((candidate) => candidate.id === step.id) !== index);
  if (duplicateId) fail(`interaction plan.steps contains duplicate id ${duplicateId.id}.`);
  const captures = steps.filter((step) => step.type === 'capture');
  const duplicateCapture = captures.find((step, index) => captures.findIndex((candidate) => candidate.name === step.name) !== index);
  if (duplicateCapture) fail(`interaction plan.steps contains duplicate capture name ${duplicateCapture.name}.`);
  const declaredBudgetMs = steps.reduce((total, step) => total + stepBudgetMs(step), 0);
  if (declaredBudgetMs > MAX_PLAN_BUDGET_MS) {
    fail(`interaction plan exceeds the ${MAX_PLAN_BUDGET_MS} ms declared budget.`, { declaredBudgetMs });
  }
  return Object.freeze({
    version: 1,
    name: normalizeId(value.name, 'interaction plan.name'),
    defaults: Object.freeze({ timeoutMs }),
    declaredBudgetMs,
    steps: Object.freeze(steps),
  });
}
