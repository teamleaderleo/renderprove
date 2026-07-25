import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdvisoryResponse, requestCloudflareAdvice } from '../src/advice/cloudflare.mjs';

const bundle = {
  version: 1,
  generatedAt: '2026-07-26T00:00:00.000Z',
  project: 'fixture',
  manifest: 'renderprove.json',
  receipt: '.renderprove/receipt.json',
  sha256: 'a'.repeat(64),
  limits: { maxFiles: 64, maxBytes: 400000, maxFileBytes: 96000 },
  summary: { files: 1, bytes: 12, redactions: 0, omissions: 0 },
  files: [{ path: 'README.md', bytes: 12, sha256: 'b'.repeat(64), redactions: 0, content: '# Fixture\n' }],
  omissions: [],
};

test('parses fenced advisory JSON and bounds fields', () => {
  const result = parseAdvisoryResponse('```json\n{"verdict":"concern","summary":"Check this","findings":[{"severity":"high","title":"Issue","evidence":[{"path":"src/app.ts","detail":"Concrete line"}],"recommendation":"Fix it"}],"strengths":["Good receipt"],"omissions":["No screenshot bytes"]}\n```');
  assert.equal(result.verdict, 'concern');
  assert.equal(result.findings[0].severity, 'high');
  assert.equal(result.findings[0].evidence[0].path, 'src/app.ts');
});

test('calls the OpenAI-compatible Cloudflare endpoint without exposing credentials', async () => {
  const requests = [];
  const advice = await requestCloudflareAdvice({
    bundle,
    accountId: 'account_123',
    apiToken: 'very-secret-api-token',
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({
        id: 'chatcmpl-test',
        model: '@cf/google/gemma-4-26b-a4b-it',
        choices: [{ message: { content: JSON.stringify({
          verdict: 'clear',
          summary: 'No concrete concern found.',
          findings: [],
          strengths: ['Receipt is present.'],
          omissions: [],
        }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /accounts\/account_123\/ai\/v1\/chat\/completions$/);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer very-secret-api-token');
  assert.equal(requests[0].body.temperature, 0);
  assert.equal(requests[0].body.seed, 17);
  assert.equal(requests[0].body.model, '@cf/google/gemma-4-26b-a4b-it');
  assert.equal(advice.authoritative, false);
  assert.equal(advice.verdict, 'clear');
  assert.deepEqual(advice.usage, { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 });
  assert.doesNotMatch(JSON.stringify(advice), /very-secret-api-token/);
  assert.equal(advice.input.files[0].content, undefined);
});

test('returns sanitized provider errors', async () => {
  await assert.rejects(() => requestCloudflareAdvice({
    bundle,
    accountId: 'account_123',
    apiToken: 'very-secret-api-token',
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'token echoed here' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }),
  }), /HTTP 401/);
});

test('rejects malformed model output', async () => {
  await assert.rejects(() => requestCloudflareAdvice({
    bundle,
    accountId: 'account_123',
    apiToken: 'very-secret-api-token',
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'I decline to emit JSON.' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  }), /no JSON object/);
});
