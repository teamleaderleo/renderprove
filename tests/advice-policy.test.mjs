import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  adviceBudgetDecision,
  applyAdvicePolicy,
  loadAdvicePolicy,
  matchesAdviceExclude,
  normalizeAdvicePolicy,
} from '../src/advice/policy.mjs';
import { buildAdviceBundle } from '../src/advice/bundle.mjs';
import { adviseProject } from '../src/advice/service.mjs';

const structuredAdvice = {
  verdict: 'clear',
  summary: 'No concrete concern found.',
  findings: [],
  strengths: ['Receipt is present.'],
  omissions: [],
};

async function makeProject({ config } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'renderprove-policy-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, '.renderprove'), { recursive: true });
  await fs.writeFile(path.join(root, 'renderprove.json'), JSON.stringify({
    version: 1,
    project: 'policy-fixture',
    target: { baseUrl: 'https://example.com' },
    review: { routes: ['/'] },
  }));
  await fs.writeFile(path.join(root, '.renderprove', 'receipt.json'), JSON.stringify({
    version: 1,
    project: 'policy-fixture',
    status: 'passed',
    cases: [],
  }));
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"policy-fixture"}\n');
  await fs.writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}\n');
  await fs.writeFile(path.join(root, 'src', 'app.js'), 'export const ready = true;\n');
  if (config) await fs.writeFile(path.join(root, 'renderprove-advice.json'), `${JSON.stringify(config, null, 2)}\n`);
  return root;
}

async function successfulFetch() {
  return new Response(JSON.stringify({
    success: true,
    result: {
      model: '@cf/google/gemma-4-26b-a4b-it',
      tool_calls: [{
        type: 'function',
        function: { name: 'report_advice', arguments: JSON.stringify(structuredAdvice) },
      }],
      usage: { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 },
    },
  }), { status: 200, headers: { 'content-type': 'application/json', 'cf-ray': 'policy-ray' } });
}

test('excludes lockfiles by default while retaining manifest, receipt, and policy evidence', async (t) => {
  const root = await makeProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const policy = await loadAdvicePolicy({ projectRoot: root });
  const raw = await buildAdviceBundle({ projectRoot: root });
  assert.equal(raw.files.some((file) => file.path === 'package-lock.json'), true);
  const bundle = applyAdvicePolicy(raw, policy, { model: '@cf/google/gemma-4-26b-a4b-it' });
  assert.equal(bundle.files.some((file) => file.path === 'package-lock.json'), false);
  assert.equal(bundle.files.some((file) => file.path === 'renderprove.json'), true);
  assert.equal(bundle.files.some((file) => file.path === '.renderprove/receipt.json'), true);
  assert.equal(bundle.files.some((file) => file.path === '.renderprove/advice-policy.generated.json'), true);
  assert.equal(bundle.omissions.some((item) => item.path === 'package-lock.json' && item.reason === 'policy-exclude'), true);
  assert.equal(bundle.budget.estimatedNeurons > 0, true);
  assert.equal(matchesAdviceExclude('nested/package-lock.json', policy.excludePatterns), true);
});

test('makes questions, scope, model, and budget part of the evidence digest', async (t) => {
  const root = await makeProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const raw = await buildAdviceBundle({ projectRoot: root });
  const firstPolicy = normalizeAdvicePolicy({
    version: 1,
    questions: ['Does retained state agree with the browser receipt?'],
    include: ['src'],
    budget: { maxEstimatedNeurons: 800, contact: '@teamleaderleo' },
  }, { projectRoot: root });
  const secondPolicy = normalizeAdvicePolicy({
    version: 1,
    questions: ['Does the selected state remain visible after deletion?'],
    include: ['src'],
    budget: { maxEstimatedNeurons: 800, contact: '@teamleaderleo' },
  }, { projectRoot: root });
  const first = applyAdvicePolicy(raw, firstPolicy, { model: '@cf/google/gemma-4-26b-a4b-it' });
  const second = applyAdvicePolicy(raw, secondPolicy, { model: '@cf/google/gemma-4-26b-a4b-it' });
  assert.notEqual(first.sha256, second.sha256);
  assert.deepEqual(first.reviewQuestions, ['Does retained state agree with the browser receipt?']);
  assert.equal(first.budget.contact, '@teamleaderleo');
});

test('skips before provider access when the conservative per-run Neuron ceiling is exceeded', async (t) => {
  const root = await makeProject({
    version: 1,
    budget: { dailyNeurons: 10_000, maxEstimatedNeurons: 1, onExceed: 'skip', contact: '@teamleaderleo' },
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let providerCalls = 0;
  const result = await adviseProject({
    projectRoot: root,
    accountId: 'account_123',
    apiToken: 'very-secret-api-token',
    fetchImpl: async () => {
      providerCalls += 1;
      return successfulFetch();
    },
  });
  assert.equal(providerCalls, 0);
  assert.equal(result.advice, null);
  assert.equal(result.status.status, 'skipped');
  assert.equal(result.status.reason, 'estimated-neuron-budget');
  assert.equal(result.status.contact, '@teamleaderleo');
  assert.equal(adviceBudgetDecision(result.bundle).allowed, false);
  const stored = JSON.parse(await fs.readFile(path.join(root, '.renderprove', 'advice-status.json'), 'utf8'));
  assert.equal(stored.status, 'skipped');
});

test('reuses an exact policy and evidence digest without a second provider call', async (t) => {
  const root = await makeProject({
    version: 1,
    questions: ['Find concrete state inconsistencies only.'],
    include: ['src'],
    budget: { maxEstimatedNeurons: 1_000 },
    cache: { reuse: true },
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let providerCalls = 0;
  const first = await adviseProject({
    projectRoot: root,
    accountId: 'account_123',
    apiToken: 'very-secret-api-token',
    fetchImpl: async () => {
      providerCalls += 1;
      return successfulFetch();
    },
  });
  const second = await adviseProject({
    projectRoot: root,
    accountId: 'account_123',
    apiToken: 'very-secret-api-token',
    fetchImpl: async () => {
      throw new Error('provider must not be called for an exact cache hit');
    },
  });
  assert.equal(providerCalls, 1);
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(second.advice.input.sha256, first.advice.input.sha256);
  assert.equal(second.status.reused, true);
});
