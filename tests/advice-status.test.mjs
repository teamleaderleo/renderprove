import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { adviseProject } from '../src/advice/service.mjs';

async function makeProject({ maxEstimatedNeurons = 1_000 } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'renderprove-exhausted-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.mkdir(path.join(root, '.renderprove'), { recursive: true });
  await fs.writeFile(path.join(root, 'renderprove.json'), JSON.stringify({
    version: 1,
    project: 'exhausted-fixture',
    target: { baseUrl: 'https://example.com' },
    review: { routes: ['/'] },
  }));
  await fs.writeFile(path.join(root, '.renderprove', 'receipt.json'), JSON.stringify({
    version: 1,
    project: 'exhausted-fixture',
    status: 'passed',
    cases: [],
  }));
  await fs.writeFile(path.join(root, 'renderprove-advice.json'), JSON.stringify({
    version: 1,
    questions: ['Return one concrete state assessment.'],
    include: ['src'],
    generation: {
      maxCompletionTokens: 3_072,
      maxFindings: 2,
      maxEvidencePerFinding: 1,
      maxStrengths: 1,
      maxOmissions: 1,
    },
    budget: {
      maxEstimatedNeurons,
      contact: '@teamleaderleo',
    },
  }));
  await fs.writeFile(path.join(root, 'src', 'app.js'), 'export const ready = true;\n');
  await fs.writeFile(path.join(root, '.renderprove', 'advice.json'), JSON.stringify({
    version: 1,
    authoritative: false,
    input: { sha256: '0'.repeat(64) },
    summary: 'stale advice must not survive',
  }));
  return root;
}

async function assertAdviceRetired(root) {
  await assert.rejects(
    fs.access(path.join(root, '.renderprove', 'advice.json')),
    (error) => error?.code === 'ENOENT',
  );
}

test('classifies native finish_reason length, persists safe diagnostics, and retires stale advice', async (t) => {
  const root = await makeProject();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(() => adviseProject({
    projectRoot: root,
    accountId: 'account_123',
    apiToken: 'very-secret-api-token',
    fetchImpl: async () => new Response(JSON.stringify({
      success: true,
      result: {
        response: '',
        finish_reason: 'length',
        usage: {
          prompt_tokens: 8_000,
          completion_tokens: 3_072,
          total_tokens: 11_072,
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  }), (error) => {
    assert.equal(error.code, 'ADVICE_COMPLETION_EXHAUSTED');
    assert.match(error.message, /exhausted the configured completion budget/);
    assert.doesNotMatch(error.message, /very-secret-api-token/);
    assert.equal(error.details.finishReason, 'length');
    assert.deepEqual(error.details.usage, {
      prompt_tokens: 8_000,
      completion_tokens: 3_072,
      total_tokens: 11_072,
    });
    return true;
  });

  await assertAdviceRetired(root);
  const status = JSON.parse(await fs.readFile(path.join(root, '.renderprove', 'advice-status.json'), 'utf8'));
  assert.equal(status.status, 'unavailable');
  assert.equal(status.reason, 'ADVICE_COMPLETION_EXHAUSTED');
  assert.equal(status.generation.maxCompletionTokens, 3_072);
  assert.equal(status.budget.contact, '@teamleaderleo');
  assert.deepEqual(status.diagnostic, {
    finishReason: 'length',
    toolCalls: 0,
    contentChars: 0,
    usage: {
      prompt_tokens: 8_000,
      completion_tokens: 3_072,
      total_tokens: 11_072,
    },
  });
  assert.doesNotMatch(JSON.stringify(status), /very-secret-api-token/);
  assert.doesNotMatch(JSON.stringify(status), /stale advice must not survive/);
});

test('retires stale advice before a budget skip without provider access', async (t) => {
  const root = await makeProject({ maxEstimatedNeurons: 1 });
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
  await assertAdviceRetired(root);
  const status = JSON.parse(await fs.readFile(path.join(root, '.renderprove', 'advice-status.json'), 'utf8'));
  assert.equal(status.status, 'skipped');
  assert.equal(status.contact, '@teamleaderleo');
  assert.doesNotMatch(JSON.stringify(status), /stale advice must not survive/);
});
