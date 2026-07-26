import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { requestCloudflareAdvice } from '../src/advice/cloudflare.mjs';
import {
  DEFAULT_ADVICE_GENERATION,
  normalizeAdviceGeneration,
} from '../src/advice/generation.mjs';
import {
  applyAdvicePolicy,
  normalizeAdvicePolicy,
} from '../src/advice/policy.mjs';
import { buildAdviceBundle } from '../src/advice/bundle.mjs';

const structuredAdvice = {
  verdict: 'clear',
  summary: 'No concrete concern found.',
  findings: [],
  strengths: [],
  omissions: [],
};

const bundle = {
  version: 1,
  generatedAt: '2026-07-26T00:00:00.000Z',
  project: 'thinking-fixture',
  manifest: 'renderprove.json',
  receipt: '.renderprove/receipt.json',
  sha256: 'a'.repeat(64),
  limits: { maxFiles: 8, maxBytes: 10000, maxFileBytes: 5000 },
  summary: { files: 1, bytes: 12, redactions: 0, omissions: 0 },
  files: [{ path: 'src/app.js', bytes: 12, sha256: 'b'.repeat(64), redactions: 0, content: 'export {};\n' }],
  omissions: [],
  reviewQuestions: ['Report concrete state defects only.'],
};

function responseFor(request) {
  const result = {
    model: '@cf/google/gemma-4-26b-a4b-it',
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
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
    headers: { 'content-type': 'application/json' },
  });
}

async function captureRequest(generation) {
  let request;
  const advice = await requestCloudflareAdvice({
    bundle,
    accountId: 'account_123',
    apiToken: 'very-secret-api-token',
    generation,
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return responseFor(request);
    },
  });
  return { request, advice };
}

test('keeps thinking enabled by default without adding model-specific template options', async () => {
  assert.equal(DEFAULT_ADVICE_GENERATION.thinking, 'enabled');
  assert.equal(normalizeAdviceGeneration({}).thinking, 'enabled');
  const { request, advice } = await captureRequest(DEFAULT_ADVICE_GENERATION);
  assert.equal('chat_template_kwargs' in request, false);
  assert.equal(request.reasoning_effort, 'low');
  assert.equal(advice.verdict, 'clear');
});

for (const responseMode of ['tool', 'json-schema']) {
  test(`disables model thinking explicitly in ${responseMode} response mode`, async () => {
    const generation = {
      ...DEFAULT_ADVICE_GENERATION,
      responseMode,
      thinking: 'disabled',
      maxFindings: 2,
      maxEvidencePerFinding: 1,
      maxStrengths: 1,
      maxOmissions: 1,
    };
    const { request, advice } = await captureRequest(generation);
    assert.deepEqual(request.chat_template_kwargs, { enable_thinking: false });
    assert.equal(request.reasoning_effort, 'low');
    if (responseMode === 'json-schema') {
      assert.equal(request.response_format.type, 'json_schema');
      assert.equal('tools' in request, false);
    } else {
      assert.equal(request.tool_choice, 'required');
      assert.equal('response_format' in request, false);
    }
    assert.equal(advice.verdict, 'clear');
  });
}

test('rejects unknown thinking modes before provider access', async () => {
  assert.throws(
    () => normalizeAdviceGeneration({ thinking: 'automatic' }),
    (error) => error.code === 'INVALID_ADVICE_ARGUMENT',
  );
  await assert.rejects(() => requestCloudflareAdvice({
    bundle,
    accountId: 'account_123',
    apiToken: 'very-secret-api-token',
    generation: { ...DEFAULT_ADVICE_GENERATION, thinking: 'automatic' },
    fetchImpl: async () => {
      throw new Error('provider must not be called');
    },
  }), (error) => error.code === 'INVALID_ADVICE_ARGUMENT');
});

test('makes thinking mode part of policy evidence, digest, and generation status', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'renderprove-thinking-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, '.renderprove'), { recursive: true });
  await fs.writeFile(path.join(root, 'renderprove.json'), JSON.stringify({
    version: 1,
    project: 'thinking-policy-fixture',
    target: { baseUrl: 'https://example.com' },
    review: { routes: ['/'] },
  }));
  await fs.writeFile(path.join(root, '.renderprove', 'receipt.json'), JSON.stringify({
    version: 1,
    project: 'thinking-policy-fixture',
    status: 'passed',
    cases: [],
  }));
  await fs.writeFile(path.join(root, 'src', 'app.js'), 'export const ready = true;\n');

  const raw = await buildAdviceBundle({ projectRoot: root, includePaths: ['src'] });
  const enabledPolicy = normalizeAdvicePolicy({
    version: 1,
    generation: { thinking: 'enabled' },
  }, { projectRoot: root });
  const disabledPolicy = normalizeAdvicePolicy({
    version: 1,
    generation: { thinking: 'disabled' },
  }, { projectRoot: root });
  const enabled = applyAdvicePolicy(raw, enabledPolicy, { model: '@cf/google/gemma-4-26b-a4b-it' });
  const disabled = applyAdvicePolicy(raw, disabledPolicy, { model: '@cf/google/gemma-4-26b-a4b-it' });

  assert.notEqual(enabled.sha256, disabled.sha256);
  assert.equal(enabled.generationPolicy.thinking, 'enabled');
  assert.equal(disabled.generationPolicy.thinking, 'disabled');
  const virtual = disabled.files.find((file) => file.path === '.renderprove/advice-policy.generated.json');
  assert.match(virtual.content, /"thinking": "disabled"/);
});
