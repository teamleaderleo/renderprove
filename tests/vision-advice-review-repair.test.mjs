import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildVisionAdviceDocument,
  collectVisionResponseBytes,
  parseCloudflareVisionAdviceResponse,
} from '../src/vision/advice.mjs';

const digest = 'a'.repeat(64);
const provider = {
  id: 'cloudflare-workers-ai',
  model: '@cf/google/gemma-4-26b-a4b-it',
  apiStyle: 'native',
  endpointKind: 'workers-ai-model-run',
  requestId: null,
};
const timing = {
  completedAt: '2026-07-27T12:00:00.000Z',
  totalMs: 1234,
  providerMs: 1000,
};
const advice = {
  assessment: 'uncertain',
  observations: [{ text: 'Inspect the control.', confidence: 'low' }],
  risks: [],
  suggestedFollowUpChecks: [],
};

function successEnvelope(content) {
  return JSON.stringify({
    choices: [{
      finish_reason: 'stop',
      message: { role: 'assistant', content, refusal: null },
    }],
  });
}

test('rejects duplicate __proto__ keys at outer, content, and tool boundaries', () => {
  const assertRejectedWithoutLeak = (operation) => assert.throws(
    operation,
    (error) => error.code === 'INVALID_VISION_PROVIDER_RESPONSE'
      && error.details?.reason === 'duplicate-object-key'
      && !JSON.stringify(error.details).includes('__proto__'),
  );

  assertRejectedWithoutLeak(() => parseCloudflareVisionAdviceResponse(
    '{"__proto__":null,"__proto__":null,"choices":[]}',
  ));

  assertRejectedWithoutLeak(() => parseCloudflareVisionAdviceResponse(successEnvelope(
    '{"__proto__":null,"__proto__":null,"assessment":"uncertain","observations":[{"text":"x","confidence":"low"}],"risks":[],"suggestedFollowUpChecks":[]}',
  )));

  assertRejectedWithoutLeak(() => parseCloudflareVisionAdviceResponse(JSON.stringify({
    choices: [{
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: {
            name: 'emit_vision_advice',
            arguments: '{"__proto__":null,"__proto__":null,"assessment":"uncertain","observations":[{"text":"x","confidence":"low"}],"risks":[],"suggestedFollowUpChecks":[]}',
          },
        }],
      },
    }],
  }), { outputMode: 'function' }));
});

test('redacts arbitrary duplicate key text from parser error details', () => {
  const privateKey = 'private-provider-secret-field';
  const payload = successEnvelope(
    `{"${privateKey}":1,"${privateKey}":2,"assessment":"uncertain","observations":[{"text":"x","confidence":"low"}],"risks":[],"suggestedFollowUpChecks":[]}`,
  );
  assert.throws(
    () => parseCloudflareVisionAdviceResponse(payload),
    (error) => error.code === 'INVALID_VISION_PROVIDER_RESPONSE'
      && error.details?.reason === 'duplicate-object-key'
      && !JSON.stringify(error.details).includes(privateKey),
  );
});

test('rejects contradictory operational metadata tuples', () => {
  assert.throws(
    () => buildVisionAdviceDocument({
      requestDigest: digest,
      operational: {
        status: 'auth-error',
        httpStatus: 429,
        providerCode: 'HTTP_429',
        retryable: false,
        diagnostic: 'Provider rate limit reached.',
      },
      provider,
      timing,
      usage: null,
      advice: null,
    }),
    (error) => error.code === 'INVALID_VISION_ADVICE'
      && /status policy/u.test(error.message),
  );

  const valid = buildVisionAdviceDocument({
    requestDigest: digest,
    operational: {
      status: 'ok',
      httpStatus: 200,
      providerCode: null,
      retryable: false,
      diagnostic: null,
    },
    provider,
    timing,
    usage: null,
    advice,
  });
  assert.equal(valid.operational.status, 'ok');
});

test('cancels an incomplete WHATWG stream when the byte bound fails', async () => {
  let reads = 0;
  let cancellations = 0;
  let releases = 0;
  const source = {
    body: {
      getReader() {
        return {
          async read() {
            reads += 1;
            return { done: false, value: Buffer.from(reads === 1 ? '123' : '456') };
          },
          async cancel() {
            cancellations += 1;
          },
          releaseLock() {
            releases += 1;
          },
        };
      },
    },
  };

  await assert.rejects(
    collectVisionResponseBytes(source, { maxBytes: 5 }),
    (error) => error.code === 'VISION_PROVIDER_RESPONSE_TOO_LARGE',
  );
  assert.equal(reads, 2);
  assert.equal(cancellations, 1);
  assert.equal(releases, 1);
});
