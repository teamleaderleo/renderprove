import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInteractionPlan } from '../src/browser/interaction-plan.mjs';
import { runInteractionPlan } from '../src/browser/interaction-executor.mjs';

function basePlan(steps, overrides = {}) {
  return {
    version: 1,
    name: 'test-plan',
    defaults: { timeoutMs: 1_000 },
    steps,
    ...overrides,
  };
}

function locatorStub(name, events, options = {}) {
  return {
    async waitFor(settings) {
      events.push(['waitFor', name, settings]);
      if (options.waitForError) throw options.waitForError;
      options.afterWaitFor?.();
    },
    async scrollIntoViewIfNeeded(settings) { events.push(['scroll', name, settings]); },
    async boundingBox() {
      events.push(['box', name]);
      return options.box ?? { x: 100, y: 50, width: 200, height: 100 };
    },
    async click(settings) { events.push(['click', name, settings]); },
    async fill(text, settings) {
      events.push(['fill', name, text, settings]);
      if (options.fillError) throw options.fillError;
    },
    async pressSequentially(text, settings) { events.push(['append', name, text, settings]); },
    async selectOption(values, settings) { events.push(['select', name, values, settings]); },
  };
}

function fakePage({ moveErrorAt = null, waitNever = false, fillError = null, afterWaitFor = null } = {}) {
  const events = [];
  let moveCount = 0;
  const locators = new Map();
  const locate = (name) => {
    if (!locators.has(name)) locators.set(name, locatorStub(name, events, { fillError, afterWaitFor }));
    return locators.get(name);
  };
  return {
    events,
    viewportSize() { return { width: 1_000, height: 800 }; },
    getByTestId(value) { events.push(['locator', 'testId', value]); return locate(`testId:${value}`); },
    getByRole(role, options) { events.push(['locator', 'role', role, options]); return locate(`role:${role}`); },
    getByLabel(value, options) { events.push(['locator', 'label', value, options]); return locate(`label:${value}`); },
    getByText(value, options) { events.push(['locator', 'text', value, options]); return locate(`text:${value}`); },
    locator(value) { events.push(['locator', 'css', value]); return locate(`css:${value}`); },
    waitForTimeout(durationMs) {
      events.push(['wait', durationMs]);
      return waitNever ? new Promise(() => {}) : Promise.resolve();
    },
    mouse: {
      async move(x, y, options) {
        moveCount += 1;
        events.push(['mouseMove', x, y, options]);
        if (moveErrorAt === moveCount) throw new Error('move failed');
      },
      async click(x, y) { events.push(['mouseClick', x, y]); },
      async down(options) { events.push(['mouseDown', options]); },
      async up(options) { events.push(['mouseUp', options]); },
    },
  };
}

test('normalizes every interaction step and accounts for target resolution and locator clicks', () => {
  const plan = normalizeInteractionPlan(basePlan([
    {
      id: 'move',
      type: 'pointerMove',
      to: { space: 'target', target: { by: 'testId', value: 'field' }, x: 0.5, y: 0.5 },
      durationMs: 100,
    },
    { id: 'click', type: 'click', target: { by: 'role', role: 'button', name: 'Open' } },
    {
      id: 'drag',
      type: 'drag',
      from: { space: 'target', target: { by: 'css', value: '#surface' }, x: 0.1, y: 0.5 },
      to: { space: 'target', target: { by: 'css', value: '#surface' }, x: 0.9, y: 0.5 },
      durationMs: 200,
    },
    { id: 'fill', type: 'fill', target: { by: 'label', value: 'Name' }, text: 'Ada' },
    { id: 'select', type: 'select', target: { by: 'testId', value: 'choice' }, values: ['one'] },
    { id: 'wait-for', type: 'waitFor', target: { by: 'text', value: 'Ready' }, state: 'visible' },
    { id: 'wait', type: 'wait', durationMs: 50 },
    { id: 'capture', type: 'capture', name: 'after' },
  ]));

  assert.equal(plan.steps.length, 8);
  assert.equal(plan.steps[0].steps, 7);
  assert.equal(plan.steps[1].target.exact, true);
  assert.equal(plan.steps[3].mode, 'replace');
  assert.equal(plan.declaredBudgetMs, 9_350);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.steps), true);
});

test('rejects unknown fields, invalid points, duplicates, oversized values, and over-budget plans', () => {
  assert.throws(
    () => normalizeInteractionPlan({ ...basePlan([{ id: 'wait', type: 'wait', durationMs: 1 }]), surprise: true }),
    /unknown fields/,
  );
  assert.throws(
    () => normalizeInteractionPlan(basePlan([{ id: 'move', type: 'pointerMove', to: { space: 'viewport', x: 2, y: 0 } }])),
    /between 0 and 1/,
  );
  assert.throws(
    () => normalizeInteractionPlan(basePlan([
      { id: 'same', type: 'wait', durationMs: 1 },
      { id: 'same', type: 'wait', durationMs: 1 },
    ])),
    /duplicate id/,
  );
  assert.throws(
    () => normalizeInteractionPlan(basePlan([
      { id: 'a', type: 'capture', name: 'same' },
      { id: 'b', type: 'capture', name: 'same' },
    ])),
    /duplicate capture name/,
  );
  assert.throws(
    () => normalizeInteractionPlan(basePlan([{ id: 'fill', type: 'fill', target: { by: 'css', value: '#x' }, text: 'x'.repeat(10_001) }])),
    /between 0 and 10000/,
  );
  assert.throws(
    () => normalizeInteractionPlan(basePlan([{ id: 'select', type: 'select', target: { by: 'css', value: '#x' }, values: ['one', 'one'] }])),
    /must be unique/,
  );
  assert.throws(
    () => normalizeInteractionPlan({
      version: 1,
      name: 'too-long',
      defaults: { timeoutMs: 30_000 },
      steps: Array.from({ length: 5 }, (_, index) => ({ id: `capture-${index}`, type: 'capture', name: `capture-${index}` })),
    }),
    /declared budget/,
  );
});

test('executes the bounded vocabulary and redacts input text and selectors from results', async () => {
  const page = fakePage();
  const captures = [];
  const completed = [];
  const plan = basePlan([
    { id: 'move', type: 'pointerMove', to: { space: 'viewport', x: 0.1, y: 0.2 }, durationMs: 0, steps: 2 },
    { id: 'click-point', type: 'click', target: { space: 'target', target: { by: 'testId', value: 'secret-button' }, x: 0.5, y: 0.5 } },
    { id: 'click-role', type: 'click', target: { by: 'role', role: 'button', name: 'Open' } },
    {
      id: 'drag',
      type: 'drag',
      from: { space: 'target', target: { by: 'css', value: '#private-surface' }, x: 0.1, y: 0.5 },
      to: { space: 'target', target: { by: 'css', value: '#private-surface' }, x: 0.9, y: 0.5 },
      durationMs: 0,
      steps: 2,
    },
    { id: 'fill', type: 'fill', target: { by: 'label', value: 'Private field' }, text: 'very secret value' },
    { id: 'append', type: 'fill', target: { by: 'css', value: '#private-input' }, text: '-tail', mode: 'append' },
    { id: 'select', type: 'select', target: { by: 'testId', value: 'private-select' }, values: ['hidden-option'] },
    { id: 'wait-for', type: 'waitFor', target: { by: 'text', value: 'Private ready text' }, state: 'visible' },
    { id: 'wait', type: 'wait', durationMs: 1 },
    { id: 'capture', type: 'capture', name: 'after', target: { by: 'css', value: '#private-surface' }, fullPage: false },
  ]);

  const result = await runInteractionPlan(page, plan, {
    capture: async (request) => { captures.push(request); },
    onStep: async (step) => { completed.push(step.id); },
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.steps.length, plan.steps.length);
  assert.deepEqual(completed, plan.steps.map((step) => step.id));
  assert.equal(captures.length, 1);
  assert.equal(captures[0].name, 'after');
  assert.ok(captures[0].locator);
  assert.ok(page.events.some((event) => event[0] === 'mouseDown'));
  assert.ok(page.events.some((event) => event[0] === 'mouseUp'));
  assert.ok(page.events.some((event) => event[0] === 'fill' && event[2] === 'very secret value'));
  assert.ok(page.events.some((event) => event[0] === 'append' && event[2] === '-tail'));
  const serialized = JSON.stringify(result);
  for (const secret of ['very secret value', 'Private field', '#private-surface', 'hidden-option']) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.deepEqual(result.steps.find((step) => step.id === 'fill').details, {
    target: 'label',
    mode: 'replace',
    textLength: 17,
  });
});

test('uses one timeout across locator resolution and click action', async () => {
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  try {
    const page = fakePage({ afterWaitFor: () => { now += 400; } });
    await runInteractionPlan(page, basePlan([{
      id: 'click',
      type: 'click',
      target: { by: 'testId', value: 'button' },
      timeoutMs: 1_000,
    }]));
    const click = page.events.find((event) => event[0] === 'click');
    assert.equal(click[2].timeout, 600);
  } finally {
    Date.now = originalNow;
  }
});

test('releases the mouse button when a drag fails', async () => {
  const page = fakePage({ moveErrorAt: 2 });
  await assert.rejects(
    runInteractionPlan(page, basePlan([{
      id: 'drag',
      type: 'drag',
      from: { space: 'viewport', x: 0.1, y: 0.1 },
      to: { space: 'viewport', x: 0.9, y: 0.9 },
      durationMs: 0,
      steps: 2,
    }])),
    (error) => error.code === 'INTERACTION_STEP_FAILED' && error.details.stepId === 'drag',
  );
  assert.equal(page.events.filter((event) => event[0] === 'mouseDown').length, 1);
  assert.equal(page.events.filter((event) => event[0] === 'mouseUp').length, 1);
});

test('cancels active waits and reports capture timeouts without raw causes', async () => {
  const page = fakePage({ waitNever: true });
  const controller = new AbortController();
  const pending = runInteractionPlan(page, basePlan([{ id: 'wait', type: 'wait', durationMs: 5_000 }]), {
    signal: controller.signal,
  });
  controller.abort(new Error('client cancelled'));
  await assert.rejects(pending, (error) => error.code === 'INTERACTION_CANCELLED');

  await assert.rejects(
    runInteractionPlan(fakePage(), basePlan([{
      id: 'capture',
      type: 'capture',
      name: 'slow',
      timeoutMs: 100,
    }]), { capture: async () => new Promise(() => {}) }),
    (error) => error.code === 'INTERACTION_STEP_FAILED'
      && error.details.failureCode === 'INTERACTION_TIMEOUT'
      && typeof error.cause === 'undefined',
  );
});

test('failed steps expose bounded metadata without raw causes, locators, or text values', async () => {
  const page = fakePage({ fillError: new Error('locator #secret-selector rejected secret input') });
  let failure;
  try {
    await runInteractionPlan(page, basePlan([{
      id: 'fill-private',
      type: 'fill',
      target: { by: 'css', value: '#secret-selector' },
      text: 'secret input',
    }]));
  } catch (error) {
    failure = error;
  }
  assert.equal(failure.code, 'INTERACTION_STEP_FAILED');
  assert.deepEqual(failure.details, {
    plan: 'test-plan',
    stepId: 'fill-private',
    stepType: 'fill',
    stepIndex: 0,
    completedSteps: 0,
    failureCode: 'INTERACTION_OPERATION_FAILED',
  });
  assert.equal(failure.cause, undefined);
  assert.equal(failure.message.includes('secret'), false);
  assert.equal(failure.stack.includes('secret'), false);
  assert.equal(JSON.stringify(failure.details).includes('secret'), false);
});
