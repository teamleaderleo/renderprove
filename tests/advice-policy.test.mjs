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
import { DEFAULT_ADVICE_GENERATION } from '../src/advice/generation.mjs';
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

async function successfulFetch(requests = []) {
  return async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    const result = {
      model: '@cf/google/gemma-4-26b-a4b-it',
      usage: { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 },
    };
    if (request.response_format) result.response = structuredAdvice;
    else {
      result.tool_calls = [{
        type: 'function',
        function: { name: 'report_advice', arguments: JSON.stringify(structuredAdvice) },
      }];
    }
    return new Response(JSON.stringify({ success: true, result }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cf-ray': 'policy-ray' },
    });
  };
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
  assert.deepEqual(bundle.generationPolicy, DEFAULT_ADVICE_GENERATION);
  assert.equal(bundle.generationPolicy.responseMode, 'tool');
  assert.equal(bundle.budget.estimatedOutputTokens, DEFAULT_ADVICE_GENERATION.maxCompletionTokens);
  assert.equal(matchesAdviceExclude('nested/package-lock.json', policy.excludePatterns), true);
});

test('makes questions, scope, model, response mode, generation limits, and budget part of the evidence digest', async (t) => {
  const root = await makeProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const raw = await buildAdviceBundle({ projectRoot: root });
  const toolPolicy = normalizeAdvicePolicy({
    version: 1,
    questions: ['Does retained state agree with the browser receipt?'],
    include: ['src'],
    generation: { responseMode: 'tool', maxCompletionTokens: 3_072, maxFindings: 4 },
    budget: { maxEstimatedNeurons: 800, contact: '@teamleaderleo' },
  }, { projectRoot: root });
  const jsonPolicy = normalizeAdvicePolicy({
    version: 1,
    questions: ['Does retained state agree with the browser receipt?'],
    include: ['src'],
    generation: { responseMode: 'json-schema', maxCompletionTokens: 3_072, maxFindings: 4 },
    budget: { maxEstimatedNeurons: 800, contact: '@teamleaderleo' },
  }, { projectRoot: root });
  const largerPolicy = normalizeAdvicePolicy({
    version: 1,
    questions: ['Does retained state agree with the browser receipt?'],
    include: ['src'],
    generation: { responseMode: 'tool', maxCompletionTokens: 3_584, maxFindings: 4 },
    budget: { maxEstimatedNeurons: 800, contact: '@teamleaderleo' },
  }, { projectRoot: root });
  const tool = applyAdvicePolicy(raw, toolPolicy, { model: '@cf/google/gemma-4-26b-a4b-it' });
  const json = applyAdvicePolicy(raw, jsonPolicy, { model: '@cf/google/gemma-4-26b-a4b-it' });
  const larger = applyAdvicePolicy(raw, largerPolicy, { model: '@cf/google/gemma-4-26b-a4b-it' });
  assert.notEqual(tool.sha256, json.sha256);
  assert.notEqual(tool.sha256, larger.sha256);
  assert.deepEqual(tool.reviewQuestions, ['Does retained state agree with the browser receipt?']);
  assert.equal(tool.generationPolicy.responseMode, 'tool');
  assert.equal(json.generationPolicy.responseMode, 'json-schema');
  assert.equal(tool.generationPolicy.maxCompletionTokens, 3_072);
  assert.equal(tool.generationPolicy.maxFindings, 4);
  assert.equal(tool.budget.estimatedOutputTokens, 3_072);
  assert.equal(json.budget.estimatedNeurons, tool.budget.estimatedNeurons);
  assert.equal(larger.budget.estimatedOutputTokens, 3_584);
  assert.equal(tool.budget.estimatedNeurons < larger.budget.estimatedNeurons, true);
  assert.equal(tool.budget.contact, '@teamleaderleo');
});

test('rejects invalid or unknown generation controls before bundle or provider work', () => {
  assert.throws(() => normalizeAdvicePolicy({
    version: 1,
    generation: { maxCompletionTokens: 512 },
  }), (error) => error.code === 'INVALID_ADVICE_CONFIG');
  assert.throws(() => normalizeAdvicePolicy({
    version: 1,
    generation: { responseMode: 'yaml' },
  }), (error) => error.code === 'INVALID_ADVICE_CONFIG');
  assert.throws(() => normalizeAdvicePolicy({
    version: 1,
    generation: { maxFindings: 4, verbosity: 'tiny' },
  }), (error) => {
    assert.equal(error.code, 'INVALID_ADVICE_CONFIG');
    assert.deepEqual(error.details.unknown, ['verbosity']);
    return true;
  });
});

test('skips before provider access when the conservative per-run Neuron ceiling is exceeded', async (t) => {
  const root = await makeProject({
    version: 1,
    generation: { responseMode: 'json-schema', maxCompletionTokens: 1_024 },
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
      return new Response('{}');
    },
  });
  assert.equal(providerCalls, 0);
  assert.equal(result.advice, null);
  assert.equal(result.status.status, 'skipped');
  assert.equal(result.status.reason, 'estimated-neuron-budget');
  assert.equal(result.status.contact, '@teamleaderleo');
  assert.equal(result.status.generation.responseMode, 'json-schema');
  assert.equal(result.status.generation.maxCompletionTokens, 1_024);
  assert.equal(adviceBudgetDecision(result.bundle).allowed, false);
  const stored = JSON.parse(await fs.readFile(path.join(root, '.renderprove', 'advice-status.json'), 'utf8'));
  assert.equal(stored.status, 'skipped');
  assert.equal(stored.generation.responseMode, 'json-schema');
  assert.equal(stored.generation.maxCompletionTokens, 1_024);
});

test('passes JSON-schema generation policy to the provider and reuses only the exact digest', async (t) => {
  const root = await makeProject({
    version: 1,
    questions: ['Find concrete state inconsistencies only.'],
    include: ['src'],
    generation: {
      responseMode: 'json-schema',
      maxCompletionTokens: 3_072,
      maxFindings: 4,
      maxEvidencePerFinding: 2,
      maxStrengths: 2,
      maxOmissions: 2,
    },
    budget: { maxEstimatedNeurons: 1_000 },
    cache: { reuse: true },
  });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const requests = [];
  const first = await adviseProject({
    projectRoot: root,
    accountId: 'account_123',
    apiToken: 'very-secret-api-token',
    fetchImpl: await successfulFetch(requests),
  });
  const second = await adviseProject({
    projectRoot: root,
    accountId: 'account_123',
    apiToken: 'very-secret-api-token',
    fetchImpl: async () => {
      throw new Error('provider must not be called for an exact cache hit');
    },
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].max_completion_tokens, 3_072);
  assert.equal('tools' in requests[0], false);
  assert.equal(requests[0].response_format.type, 'json_schema');
  assert.equal(requests[0].response_format.json_schema.properties.findings.maxItems, 4);
  assert.equal(requests[0].response_format.json_schema.properties.findings.items.properties.evidence.maxItems, 2);
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(second.advice.input.sha256, first.advice.input.sha256);
  assert.equal(second.status.reused, true);
  assert.equal(second.status.generation.responseMode, 'json-schema');
  assert.equal(second.status.generation.maxCompletionTokens, 3_072);
});
