import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  VISION_ADVICE_LIMITS,
  VISION_ADVICE_PAYLOAD_SCHEMA,
  VISION_ADVICE_SCHEMA,
  buildVisionAdviceDocument,
  buildVisionOperationalStatus,
  collectVisionResponseBytes,
  mapVisionOperationalFailure,
  normalizeVisionAdvicePayload,
  normalizeVisionUsage,
  parseCloudflareVisionAdviceResponse,
  parseCloudflareVisionAdviceStream,
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
  assessment: 'review-recommended',
  observations: [{ text: ' Save\n\taction   is visually distinct. ', confidence: 'high' }],
  risks: [{ text: 'Warning competes with the heading.', severity: 'low' }],
  suggestedFollowUpChecks: [{ text: 'Verify keyboard focus visibility.' }],
};

function successObject(payload = advice) {
  return {
    success: true,
    result: {
      id: 'chatcmpl_synthetic',
      model: '@cf/google/gemma-4-26b-a4b-it',
      choices: [{
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: JSON.stringify(payload), refusal: null },
      }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        prompt_tokens_details: { cached_tokens: 4 },
        completion_tokens_details: { reasoning_tokens: 0 },
      },
      system_fingerprint: 'fp_synthetic',
    },
  };
}

function successEnvelope(payload = advice) {
  return JSON.stringify(successObject(payload));
}

function functionEnvelope({ calls, content = null, parsed } = {}) {
  const message = { role: 'assistant', content, refusal: null, tool_calls: calls };
  if (parsed !== undefined) message.parsed = parsed;
  return JSON.stringify({
    choices: [{ finish_reason: 'tool_calls', message }],
  });
}

function visionCall(argumentsValue = JSON.stringify(advice), name = 'emit_vision_advice') {
  return {
    id: 'call_1',
    type: 'function',
    function: { name, arguments: argumentsValue },
  };
}

function resolveRef(root, ref) {
  assert.match(ref, /^#\//u);
  return ref.slice(2).split('/').reduce(
    (value, segment) => value[segment.replace(/~1/gu, '/').replace(/~0/gu, '~')],
    root,
  );
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  if (typeof value === 'number') return 'number';
  return typeof value;
}

function schemaErrors(value, schema, root = schema, at = '$') {
  if (schema.$ref) return schemaErrors(value, resolveRef(root, schema.$ref), root, at);
  const errors = [];
  if (schema.allOf) {
    for (const child of schema.allOf) errors.push(...schemaErrors(value, child, root, at));
  }
  if (schema.anyOf) {
    const matches = schema.anyOf.filter((child) => schemaErrors(value, child, root, at).length === 0);
    if (matches.length === 0) errors.push(`${at} must match an anyOf branch`);
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((child) => schemaErrors(value, child, root, at).length === 0);
    if (matches.length !== 1) errors.push(`${at} must match exactly one oneOf branch`);
  }
  if (schema.not && schemaErrors(value, schema.not, root, at).length === 0) errors.push(`${at} matches a forbidden schema`);
  if (schema.if) {
    const condition = schemaErrors(value, schema.if, root, at).length === 0;
    if (condition && schema.then) errors.push(...schemaErrors(value, schema.then, root, at));
    if (!condition && schema.else) errors.push(...schemaErrors(value, schema.else, root, at));
  }
  if (Object.hasOwn(schema, 'const') && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push(`${at} must equal ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !schema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
    errors.push(`${at} is outside enum`);
  }
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = valueType(value);
    if (!allowed.includes(actual)) return [...errors, `${at} expected ${allowed.join('|')} but received ${actual}`];
  }
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${at} shorter than minLength`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${at} longer than maxLength`);
    if (schema.pattern && !(new RegExp(schema.pattern, 'u')).test(value)) errors.push(`${at} does not match pattern`);
    if (schema['x-maxUtf8Bytes'] != null && Buffer.byteLength(value, 'utf8') > schema['x-maxUtf8Bytes']) {
      errors.push(`${at} exceeds x-maxUtf8Bytes`);
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${at} below minimum`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${at} above maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${at} has too few items`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${at} has too many items`);
    if (schema.contains) {
      const count = value.filter((item, index) => schemaErrors(item, schema.contains, root, `${at}[${index}]`).length === 0).length;
      if (count < (schema.minContains ?? 1)) errors.push(`${at} does not contain a matching item`);
      if (schema.maxContains != null && count > schema.maxContains) errors.push(`${at} contains too many matching items`);
    }
    if (schema.items) {
      for (const [index, item] of value.entries()) errors.push(...schemaErrors(item, schema.items, root, `${at}[${index}]`));
    }
  }
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${at}.${key} is required`);
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${at}.${key} is unexpected`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) errors.push(...schemaErrors(value[key], childSchema, root, `${at}.${key}`));
    }
  }
  if (schema['x-maxUtf8Bytes'] != null && value != null && typeof value === 'object') {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > schema['x-maxUtf8Bytes']) errors.push(`${at} exceeds x-maxUtf8Bytes`);
  }
  return errors;
}

test('normalizes whitespace and builds schema-identified advisory document', () => {
  const normalized = normalizeVisionAdvicePayload(advice);
  assert.equal(normalized.observations[0].text, 'Save action is visually distinct.');
  const document = buildVisionAdviceDocument({
    requestDigest: digest,
    operational: buildVisionOperationalStatus({ status: 'ok', httpStatus: 200 }),
    provider,
    timing,
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      reasoningTokens: 0,
      cachedInputTokens: 4,
    },
    advice: normalized,
  });
  assert.equal(document.$schema, VISION_ADVICE_SCHEMA);
  assert.equal(document.schemaVersion, 'vision-advice-v1');
  assert.equal(document.operational.status, 'ok');
  assert.ok(Buffer.byteLength(JSON.stringify(document), 'utf8') <= VISION_ADVICE_LIMITS.normalizedDocumentBytes);
});

test('validates emitted private payload and public document against exported schemas', async () => {
  const payloadSchema = JSON.parse(await fs.readFile(new URL('../schema/vision-advice-payload-v1.schema.json', import.meta.url), 'utf8'));
  const publicSchema = JSON.parse(await fs.readFile(new URL('../schema/vision-advice-v1.schema.json', import.meta.url), 'utf8'));
  assert.equal(payloadSchema.$id, VISION_ADVICE_PAYLOAD_SCHEMA);
  assert.equal(publicSchema.$id, VISION_ADVICE_SCHEMA);
  const normalized = normalizeVisionAdvicePayload(advice);
  const document = buildVisionAdviceDocument({
    requestDigest: digest,
    operational: buildVisionOperationalStatus({ status: 'ok', httpStatus: 200 }),
    provider,
    timing,
    usage: null,
    advice: normalized,
  });
  assert.deepEqual(schemaErrors(normalized, payloadSchema), []);
  assert.deepEqual(schemaErrors(document, publicSchema), []);
});

test('collects bounded async chunks and parses across arbitrary chunk boundaries', async () => {
  const bytes = Buffer.from(successEnvelope(), 'utf8');
  async function* chunks() {
    for (let offset = 0; offset < bytes.length; offset += 7) yield bytes.subarray(offset, offset + 7);
  }
  const collected = await collectVisionResponseBytes(chunks());
  assert.deepEqual(collected, bytes);
  const parsed = await parseCloudflareVisionAdviceStream(chunks());
  assert.equal(parsed.channel, 'message.content-text');
  assert.equal(parsed.advice.assessment, 'review-recommended');
});

test('stops streamed collection as soon as the byte ceiling is crossed', async () => {
  let yielded = 0;
  async function* chunks() {
    yielded += 1;
    yield Buffer.from('123');
    yielded += 1;
    yield Buffer.from('456');
    yielded += 1;
    yield Buffer.from('789');
  }
  await assert.rejects(
    collectVisionResponseBytes(chunks(), { maxBytes: 5 }),
    (error) => error.code === 'VISION_PROVIDER_RESPONSE_TOO_LARGE',
  );
  assert.equal(yielded, 2);
});

test('rejects malformed UTF-8, including a split invalid sequence', async () => {
  async function* chunks() {
    yield Buffer.from('{"choices":');
    yield Buffer.from([0xc3]);
    yield Buffer.from([0x28]);
  }
  await assert.rejects(
    parseCloudflareVisionAdviceStream(chunks()),
    (error) => error.code === 'INVALID_VISION_PROVIDER_RESPONSE' && /UTF-8/u.test(error.message),
  );
});

test('rejects duplicate keys in outer envelopes, text payloads, and tool arguments', () => {
  const duplicateOuter = '{"choices":[],"choices":[]}';
  assert.throws(
    () => parseCloudflareVisionAdviceResponse(duplicateOuter),
    (error) => error.code === 'INVALID_VISION_PROVIDER_RESPONSE' && error.details.key === 'choices',
  );
  const duplicatePayload = JSON.stringify({
    choices: [{
      finish_reason: 'stop',
      message: {
        content: '{"assessment":"uncertain","assessment":"review-recommended","observations":[{"text":"x","confidence":"low"}],"risks":[],"suggestedFollowUpChecks":[]}',
      },
    }],
  });
  assert.throws(
    () => parseCloudflareVisionAdviceResponse(duplicatePayload),
    (error) => error.code === 'INVALID_VISION_PROVIDER_RESPONSE' && error.details.key === 'assessment',
  );
  const duplicateArguments = '{"assessment":"uncertain","observations":[{"text":"x","confidence":"low"}],"risks":[],"risks":[],"suggestedFollowUpChecks":[]}';
  assert.throws(
    () => parseCloudflareVisionAdviceResponse(functionEnvelope({ calls: [visionCall(duplicateArguments)] }), { outputMode: 'function' }),
    (error) => error.code === 'INVALID_VISION_PROVIDER_RESPONSE' && error.details.key === 'risks',
  );
});

test('requires exactly one reviewed structured-output channel', () => {
  const objectAndTextImpossible = JSON.stringify({
    choices: [{
      finish_reason: 'stop',
      message: { parsed: advice, content: JSON.stringify(advice) },
    }],
  });
  assert.throws(
    () => parseCloudflareVisionAdviceResponse(objectAndTextImpossible),
    (error) => error.code === 'INVALID_VISION_PROVIDER_RESPONSE' && error.details.channels.length === 2,
  );
  assert.throws(
    () => parseCloudflareVisionAdviceResponse(functionEnvelope({
      calls: [visionCall(), visionCall('{}', 'other_tool')],
    }), { outputMode: 'function' }),
    (error) => error.code === 'INVALID_VISION_PROVIDER_RESPONSE' && error.details.toolCalls === 2,
  );
  assert.throws(
    () => parseCloudflareVisionAdviceResponse(functionEnvelope({
      calls: [visionCall()],
      content: JSON.stringify(advice),
    }), { outputMode: 'function' }),
    (error) => error.code === 'INVALID_VISION_PROVIDER_RESPONSE' && error.details.channels.length === 2,
  );
});

test('reports the selected structured-output channel', () => {
  const parsedObject = parseCloudflareVisionAdviceResponse(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { parsed: advice, content: null } }],
  }));
  assert.equal(parsedObject.channel, 'message.parsed');
  const parsedTool = parseCloudflareVisionAdviceResponse(functionEnvelope({ calls: [visionCall()] }), { outputMode: 'function' });
  assert.equal(parsedTool.channel, 'tool-call');
});

test('maps HTTP and local operational failures without raw provider messages', () => {
  const cases = [
    [{ httpStatus: 401 }, 'auth-error', 'HTTP_401'],
    [{ httpStatus: 403 }, 'permission-error', 'HTTP_403'],
    [{ httpStatus: 408 }, 'timeout', 'HTTP_408'],
    [{ httpStatus: 413 }, 'invalid-request', 'HTTP_413'],
    [{ httpStatus: 429 }, 'rate-limited', 'HTTP_429'],
    [{ httpStatus: 503 }, 'unavailable', 'HTTP_5XX'],
    [{ deadlineExceeded: true }, 'timeout', 'DEADLINE_EXCEEDED'],
    [{ cancelled: true }, 'cancelled', 'CALLER_CANCELLED'],
    [{ error: Object.assign(new Error('secret socket detail'), { code: 'ECONNRESET' }) }, 'transport-error', 'TRANSPORT_FAILURE'],
    [{ responseTooLarge: true }, 'response-too-large', 'RESPONSE_TOO_LARGE'],
    [{ invalidResponse: true }, 'invalid-response', 'INVALID_RESPONSE'],
    [{ cloudflareFailure: true }, 'unavailable', 'CLOUDFLARE_FAILURE'],
  ];
  for (const [input, status, providerCode] of cases) {
    const mapped = mapVisionOperationalFailure(input);
    assert.equal(mapped.status, status);
    assert.equal(mapped.providerCode, providerCode);
    assert.equal(JSON.stringify(mapped).includes('secret socket detail'), false);
  }
});

test('Cloudflare failure exposes only normalized operational metadata', () => {
  assert.throws(
    () => parseCloudflareVisionAdviceResponse(JSON.stringify({
      success: false,
      errors: [{ code: 7000, message: 'PRIVATE provider body' }],
    })),
    (error) => error.code === 'VISION_PROVIDER_OPERATIONAL_FAILURE'
      && error.details.operational.providerCode === 'CLOUDFLARE_FAILURE'
      && !JSON.stringify(error.details).includes('PRIVATE provider body'),
  );
});

test('enforces timing and token arithmetic consistency', () => {
  assert.throws(
    () => buildVisionAdviceDocument({
      requestDigest: digest,
      operational: buildVisionOperationalStatus({ status: 'ok', httpStatus: 200 }),
      provider,
      timing: { ...timing, totalMs: 10, providerMs: 11 },
      usage: null,
      advice,
    }),
    /providerMs must not exceed/u,
  );
  assert.throws(
    () => normalizeVisionUsage({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 16,
      reasoningTokens: 1,
      cachedInputTokens: 0,
    }),
    /totalTokens must equal/u,
  );
});

test('enforces successful advice and assessment consistency', () => {
  assert.throws(
    () => normalizeVisionAdvicePayload({
      assessment: 'uncertain', observations: [], risks: [], suggestedFollowUpChecks: [],
    }),
    /at least one advice item/u,
  );
  assert.throws(
    () => normalizeVisionAdvicePayload({
      assessment: 'no-obvious-concern',
      observations: [{ text: 'Visible page.', confidence: 'high' }],
      risks: [{ text: 'Critical overlap.', severity: 'high' }],
      suggestedFollowUpChecks: [],
    }),
    /high-severity risk/u,
  );
  assert.throws(
    () => normalizeVisionAdvicePayload({
      assessment: 'review-recommended',
      observations: [{ text: 'Visible page.', confidence: 'high' }],
      risks: [],
      suggestedFollowUpChecks: [],
    }),
    /requires a risk or suggested/u,
  );
});

test('parses usage and rejects inconsistent provider counters', () => {
  const parsed = parseCloudflareVisionAdviceResponse(successEnvelope());
  assert.equal(parsed.usage.inputTokens, 100);
  assert.equal(parsed.usage.cachedInputTokens, 4);
  const inconsistent = successObject();
  inconsistent.result.usage.total_tokens = 121;
  assert.throws(
    () => parseCloudflareVisionAdviceResponse(JSON.stringify(inconsistent)),
    /totalTokens must equal/u,
  );
});

test('rejects excessive arrays, UTF-8 fields, response overflow, and unsupported endings', () => {
  assert.throws(
    () => normalizeVisionAdvicePayload({
      ...advice,
      observations: Array.from({ length: 9 }, () => ({ text: 'Observation', confidence: 'low' })),
    }),
    (error) => error.code === 'VISION_ADVICE_LIMIT_EXCEEDED',
  );
  assert.throws(
    () => normalizeVisionAdvicePayload({
      ...advice,
      observations: [{ text: '💾'.repeat(81), confidence: 'high' }],
    }),
    (error) => error.code === 'VISION_ADVICE_LIMIT_EXCEEDED',
  );
  assert.throws(
    () => parseCloudflareVisionAdviceResponse(' '.repeat(VISION_ADVICE_LIMITS.rawResponseBytes + 1)),
    (error) => error.code === 'VISION_PROVIDER_RESPONSE_TOO_LARGE',
  );
  assert.throws(
    () => parseCloudflareVisionAdviceResponse(JSON.stringify({
      choices: [{ finish_reason: 'length', message: { content: JSON.stringify(advice) } }],
    })),
    (error) => error.code === 'INVALID_VISION_PROVIDER_RESPONSE' && error.details.finishReason === 'length',
  );
});

test('keeps operational failure separate from advice', () => {
  const document = buildVisionAdviceDocument({
    requestDigest: digest,
    operational: mapVisionOperationalFailure({ httpStatus: 429 }),
    provider,
    timing,
    usage: null,
    advice: null,
  });
  assert.equal(document.operational.retryable, true);
  assert.equal(document.advice, null);
  assert.throws(
    () => buildVisionAdviceDocument({
      requestDigest: digest,
      operational: mapVisionOperationalFailure({ httpStatus: 408 }),
      provider,
      timing,
      usage: null,
      advice,
    }),
    /must use advice: null/u,
  );
});
