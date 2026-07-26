import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADVISORY_RESPONSE_SCHEMA,
  parseAdvisoryResponse,
  requestCloudflareAdvice,
} from '../src/advice/cloudflare.mjs';

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

const structuredAdvice = {
  verdict: 'clear',
  summary: 'No concrete concern found.',
  findings: [],
  strengths: ['Receipt is present.'],
  omissions: [],
};

test('parses fenced and structured advisory JSON while bounding fields', () => {
  const fenced = parseAdvisoryResponse('```json\n{"verdict":"concern","summary":"Check this","findings":[{"severity":"high","title":"Issue","evidence":[{"path":"src/app.ts","detail":"Concrete line"}],"recommendation":"Fix it"}],"strengths":["Good receipt"],"omissions":["No screenshot bytes"]}\n```');
  assert.equal(fenced.verdict, 'concern');
  assert.equal(fenced.findings[0].severity, 'high');
  assert.equal(fenced.findings[0].evidence[0].path, 'src/app.ts');

  const structured = parseAdvisoryResponse(structuredAdvice);
  assert.deepEqual(structured, structuredAdvice);
});

test('calls the native Workers AI endpoint with the provider-required function envelope', async () => {
  const requests = [];
  const advice = await requestCloudflareAdvice({
    bundle,
    accountId: 'account_123',
    apiToken: 'very-secret-api-token',
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({
        success: true,
        result: {
          model: '@cf/google/gemma-4-26b-a4b-it',
          tool_calls: [{
            type: 'function',
            function: {
              name: 'report_advice',
              arguments: JSON.stringify(structuredAdvice),
            },
          }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'cf-ray': 'request-ray' },
      });
    },
  });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /accounts\/account_123\/ai\/run\/@cf\/google\/gemma-4-26b-a4b-it$/);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer very-secret-api-token');
  assert.equal(requests[0].body.temperature, 0);
  assert.equal(requests[0].body.seed, 17);
  assert.equal(requests[0].body.max_completion_tokens, 4096);
  assert.deepEqual(requests[0].body.tools, [{
    type: 'function',
    function: {
      name: 'report_advice',
      description: 'Return the final bounded, non-authoritative Renderprove advisory assessment.',
      parameters: ADVISORY_RESPONSE_SCHEMA,
    },
  }]);
  assert.equal('tool_choice' in requests[0].body, false);
  assert.equal('parallel_tool_calls' in requests[0].body, false);
  assert.equal('model' in requests[0].body, false);
  assert.equal('response_format' in requests[0].body, false);
  assert.equal(advice.authoritative, false);
  assert.equal(advice.verdict, 'clear');
  assert.deepEqual(advice.usage, { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 });
  assert.doesNotMatch(JSON.stringify(advice), /very-secret-api-token/);
  assert.equal(advice.input.files[0].content, undefined);
  assert.equal(advice.generation.maxCompletionTokens, 4096);
  assert.equal(advice.providerRequestId, 'request-ray');
});

test('accepts flat Workers AI tool arguments as a compatibility fallback', async () => {
  const advice = await requestCloudflareAdvice({
    bundle,
    accountId: 'account_123',
    apiToken: 'very-secret-api-token',
    fetchImpl: async () => new Response(JSON.stringify({
      success: true,
      result: {
        tool_calls: [{ name: 'report_advice', arguments: structuredAdvice }],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  assert.equal(advice.verdict, 'clear');
});

test('returns useful provider validation errors with exact credentials redacted', async () => {
  await assert.rejects(() => requestCloudflareAdvice({
    bundle,
    accountId: 'account_123',
    apiToken: 'very-secret-api-token',
    fetchImpl: async () => new Response(JSON.stringify({
      success: false,
      errors: [{
        code: 8007,
        message: "validation error: ('body', 'tools', 0, 'function') Field required; invalid token very-secret-api-token",
      }],
    }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }),
  }), (error) => {
    assert.equal(error.code, 'CLOUDFLARE_HTTP_400');
    assert.match(error.message, /Field required/);
    assert.match(error.message, /function/);
    assert.doesNotMatch(error.message, /very-secret-api-token/);
    assert.deepEqual(error.details.errorCodes, ['8007']);
    assert.match(error.details.errorMessages[0], /\[REDACTED\]/);
    assert.doesNotMatch(JSON.stringify(error.details), /very-secret-api-token/);
    return true;
  });
});

test('reports a privacy-safe provider envelope when output is unusable', async () => {
  await assert.rejects(() => requestCloudflareAdvice({
    bundle,
    accountId: 'account_123',
    apiToken: 'very-secret-api-token',
    fetchImpl: async () => new Response(JSON.stringify({
      success: true,
      result: {
        response: 'I decline to call the tool.',
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  }), (error) => {
    assert.equal(error.code, 'INVALID_ADVICE_RESPONSE');
    assert.match(error.message, /Provider envelope/);
    assert.match(error.message, /contentChars/);
    assert.doesNotMatch(error.message, /decline/);
    assert.deepEqual(error.details.topLevelKeys, ['result', 'success']);
    assert.deepEqual(error.details.resultKeys, ['response', 'usage']);
    assert.equal(error.details.toolCalls, 0);
    assert.equal(error.details.contentChars, 27);
    return true;
  });
});
