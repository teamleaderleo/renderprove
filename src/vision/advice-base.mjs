import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';
import { RenderproveError } from '../core/errors.mjs';

export const VISION_ADVICE_SCHEMA_VERSION = 'vision-advice-v1';
export const VISION_ADVICE_PAYLOAD_VERSION = 'vision-advice-payload-v1';
export const VISION_ADVICE_AUTHORITY = 'advisory';
export const VISION_ADVICE_TOOL_NAME = 'emit_vision_advice';
export const VISION_ADVICE_SCHEMA = 'https://raw.githubusercontent.com/teamleaderleo/renderprove/main/schema/vision-advice-v1.schema.json';
export const VISION_ADVICE_PAYLOAD_SCHEMA = 'https://raw.githubusercontent.com/teamleaderleo/renderprove/main/schema/vision-advice-payload-v1.schema.json';

export const VISION_ADVICE_LIMITS = Object.freeze({
  rawResponseBytes: 131_072,
  normalizedDocumentBytes: 16_384,
  observations: 8,
  risks: 6,
  suggestedFollowUpChecks: 6,
  adviceTextBytes: 320,
  diagnosticBytes: 256,
  providerIdBytes: 64,
  modelIdBytes: 128,
  providerCodeBytes: 64,
  providerRequestIdBytes: 128,
  endpointKindBytes: 64,
  systemFingerprintBytes: 128,
  tokenCount: 10_000_000,
  timingMs: 300_000,
});

export const VISION_OPERATIONAL_STATUSES = Object.freeze([
  'ok',
  'auth-error',
  'permission-error',
  'invalid-request',
  'timeout',
  'rate-limited',
  'unavailable',
  'transport-error',
  'response-too-large',
  'invalid-response',
  'cancelled',
]);

export const VISION_PROVIDER_CODES = Object.freeze([
  'HTTP_401',
  'HTTP_403',
  'HTTP_408',
  'HTTP_413',
  'HTTP_429',
  'HTTP_4XX',
  'HTTP_5XX',
  'DEADLINE_EXCEEDED',
  'CALLER_CANCELLED',
  'TRANSPORT_FAILURE',
  'RESPONSE_TOO_LARGE',
  'INVALID_RESPONSE',
  'CLOUDFLARE_FAILURE',
]);

const OPERATIONAL_DIAGNOSTICS = Object.freeze({
  ok: null,
  'auth-error': 'Provider authentication failed.',
  'permission-error': 'Provider permission was denied.',
  'invalid-request': 'Provider rejected the request.',
  timeout: 'Provider deadline was exceeded.',
  'rate-limited': 'Provider rate limit reached.',
  unavailable: 'Provider service is unavailable.',
  'transport-error': 'Provider transport failed.',
  'response-too-large': 'Provider response exceeded the byte limit.',
  'invalid-response': 'Provider response was invalid.',
  cancelled: 'Provider request was cancelled.',
});

const ASSESSMENTS = new Set(['no-obvious-concern', 'review-recommended', 'uncertain']);
const CONFIDENCES = new Set(['low', 'medium', 'high']);
const SEVERITIES = new Set(['low', 'medium', 'high']);
const API_STYLES = new Set(['native', 'openai-compatible']);
const SUCCESS_FINISH_REASONS = new Set(['stop', 'tool_calls', 'function_call']);
const RETRYABLE_STATUSES = new Set(['timeout', 'rate-limited', 'unavailable', 'transport-error']);
const ALLOWED_PROVIDER_CODES = new Set(VISION_PROVIDER_CODES);
const ALLOWED_DIAGNOSTICS = new Set(Object.values(OPERATIONAL_DIAGNOSTICS).filter(Boolean));
const FORBIDDEN_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const DIGEST_RE = /^[a-f0-9]{64}$/u;
const CANONICAL_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const FATAL_UTF8 = new TextDecoder('utf-8', { fatal: true });
const NETWORK_ERROR_CODES = new Set([
  'EAI_AGAIN', 'ENOTFOUND', 'ECONNABORTED', 'ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH',
  'ENETUNREACH', 'EPIPE', 'ETIMEDOUT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

function fail(message, code = 'INVALID_VISION_ADVICE', details, cause) {
  throw new RenderproveError(message, { code, details, cause });
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function requireObject(value, label) {
  if (!isPlainObject(value)) fail(`${label} must be an object.`);
  return value;
}

function requireExactKeys(value, required, optional, label) {
  const object = requireObject(value, label);
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(object);
  const unknown = keys.filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    fail(`${label} contains unknown fields.`, 'INVALID_VISION_ADVICE', { label, unknown: unknown.sort() });
  }
  const missing = required.filter((key) => !Object.hasOwn(object, key));
  if (missing.length > 0) {
    fail(`${label} is missing required fields.`, 'INVALID_VISION_ADVICE', { label, missing: missing.sort() });
  }
  return object;
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function normalizeText(value, { label, maxBytes, nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string') fail(`${label} must be a string${nullable ? ' or null' : ''}.`);
  const nfc = value.normalize('NFC').replace(/\r\n?/gu, '\n');
  if (FORBIDDEN_CONTROLS.test(nfc)) fail(`${label} contains forbidden control characters.`);
  const normalized = nfc.replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0) fail(`${label} must not be empty.`);
  const bytes = byteLength(normalized);
  if (bytes > maxBytes) {
    fail(`${label} exceeds its UTF-8 byte limit.`, 'VISION_ADVICE_LIMIT_EXCEEDED', { label, bytes, maxBytes });
  }
  return normalized;
}

function normalizeNullableText(value, options) {
  if (value === null || value === undefined) return null;
  return normalizeText(value, { ...options, nullable: false });
}

function requireEnum(value, allowed, label) {
  if (typeof value !== 'string' || !allowed.has(value)) {
    fail(`${label} has an unsupported value.`, 'INVALID_VISION_ADVICE', { label, value, allowed: [...allowed] });
  }
  return value;
}

function normalizeInteger(value, { label, minimum = 0, maximum, nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${label} must be an integer between ${minimum} and ${maximum}${nullable ? ', or null' : ''}.`);
  }
  return value;
}

function normalizeHttpStatus(value) {
  if (value === null) return null;
  return normalizeInteger(value, { label: 'operational.httpStatus', minimum: 100, maximum: 599 });
}

function normalizeCanonicalDate(value) {
  if (typeof value !== 'string' || !CANONICAL_DATE_RE.test(value)) {
    fail('timing.completedAt must be a canonical UTC timestamp with milliseconds.');
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    fail('timing.completedAt must be a valid canonical UTC timestamp.');
  }
  return value;
}

function normalizeAdviceList(value, { label, maxItems, normalizeItem }) {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  if (value.length > maxItems) {
    fail(`${label} exceeds its item limit.`, 'VISION_ADVICE_LIMIT_EXCEEDED', {
      label, items: value.length, maxItems,
    });
  }
  return value.map((item, index) => normalizeItem(item, `${label}[${index}]`));
}

function normalizeObservation(value, label) {
  const object = requireExactKeys(value, ['text', 'confidence'], [], label);
  return {
    text: normalizeText(object.text, { label: `${label}.text`, maxBytes: VISION_ADVICE_LIMITS.adviceTextBytes }),
    confidence: requireEnum(object.confidence, CONFIDENCES, `${label}.confidence`),
  };
}

function normalizeRisk(value, label) {
  const object = requireExactKeys(value, ['text', 'severity'], [], label);
  return {
    text: normalizeText(object.text, { label: `${label}.text`, maxBytes: VISION_ADVICE_LIMITS.adviceTextBytes }),
    severity: requireEnum(object.severity, SEVERITIES, `${label}.severity`),
  };
}

function normalizeSuggestedCheck(value, label) {
  const object = requireExactKeys(value, ['text'], [], label);
  return {
    text: normalizeText(object.text, { label: `${label}.text`, maxBytes: VISION_ADVICE_LIMITS.adviceTextBytes }),
  };
}

function assertAdviceConsistency(advice) {
  const itemCount = advice.observations.length + advice.risks.length + advice.suggestedFollowUpChecks.length;
  if (itemCount === 0) fail('Successful vision advice requires at least one advice item.');
  if (advice.assessment === 'no-obvious-concern' && advice.risks.some((risk) => risk.severity === 'high')) {
    fail('no-obvious-concern cannot be combined with a high-severity risk.');
  }
  if (advice.assessment === 'review-recommended'
    && advice.risks.length === 0 && advice.suggestedFollowUpChecks.length === 0) {
    fail('review-recommended requires a risk or suggested follow-up check.');
  }
  return advice;
}

export function normalizeVisionAdvicePayload(value) {
  const object = requireExactKeys(
    value,
    ['assessment', 'observations', 'risks', 'suggestedFollowUpChecks'],
    [],
    'vision advice payload',
  );
  return deepFreeze(assertAdviceConsistency({
    assessment: requireEnum(object.assessment, ASSESSMENTS, 'advice.assessment'),
    observations: normalizeAdviceList(object.observations, {
      label: 'advice.observations',
      maxItems: VISION_ADVICE_LIMITS.observations,
      normalizeItem: normalizeObservation,
    }),
    risks: normalizeAdviceList(object.risks, {
      label: 'advice.risks',
      maxItems: VISION_ADVICE_LIMITS.risks,
      normalizeItem: normalizeRisk,
    }),
    suggestedFollowUpChecks: normalizeAdviceList(object.suggestedFollowUpChecks, {
      label: 'advice.suggestedFollowUpChecks',
      maxItems: VISION_ADVICE_LIMITS.suggestedFollowUpChecks,
      normalizeItem: normalizeSuggestedCheck,
    }),
  }));
}

function normalizeOperational(value) {
  const object = requireExactKeys(
    value,
    ['status', 'httpStatus', 'providerCode', 'retryable', 'diagnostic'],
    [],
    'operational',
  );
  const status = requireEnum(object.status, new Set(VISION_OPERATIONAL_STATUSES), 'operational.status');
  if (typeof object.retryable !== 'boolean') fail('operational.retryable must be a boolean.');
  const expectedRetryable = RETRYABLE_STATUSES.has(status);
  if (object.retryable !== expectedRetryable) {
    fail('operational.retryable does not match the status policy.', 'INVALID_VISION_ADVICE', {
      status, expectedRetryable,
    });
  }
  const providerCode = normalizeNullableText(object.providerCode, {
    label: 'operational.providerCode',
    maxBytes: VISION_ADVICE_LIMITS.providerCodeBytes,
  });
  if (providerCode !== null && !ALLOWED_PROVIDER_CODES.has(providerCode)) {
    fail('operational.providerCode is outside the allowlist.');
  }
  const diagnostic = normalizeNullableText(object.diagnostic, {
    label: 'operational.diagnostic',
    maxBytes: VISION_ADVICE_LIMITS.diagnosticBytes,
  });
  if (diagnostic !== null && !ALLOWED_DIAGNOSTICS.has(diagnostic)) {
    fail('operational.diagnostic is outside the fixed diagnostic allowlist.');
  }
  if (status === 'ok' && (providerCode !== null || diagnostic !== null)) {
    fail('Successful operational status must omit providerCode and diagnostic.');
  }
  return deepFreeze({
    status,
    httpStatus: normalizeHttpStatus(object.httpStatus),
    providerCode,
    retryable: object.retryable,
    diagnostic,
  });
}

function normalizeProvider(value) {
  const object = requireExactKeys(value, ['id', 'model', 'apiStyle', 'endpointKind', 'requestId'], [], 'provider');
  return deepFreeze({
    id: normalizeText(object.id, { label: 'provider.id', maxBytes: VISION_ADVICE_LIMITS.providerIdBytes }),
    model: normalizeText(object.model, { label: 'provider.model', maxBytes: VISION_ADVICE_LIMITS.modelIdBytes }),
    apiStyle: requireEnum(object.apiStyle, API_STYLES, 'provider.apiStyle'),
    endpointKind: normalizeText(object.endpointKind, {
      label: 'provider.endpointKind', maxBytes: VISION_ADVICE_LIMITS.endpointKindBytes,
    }),
    requestId: normalizeNullableText(object.requestId, {
      label: 'provider.requestId', maxBytes: VISION_ADVICE_LIMITS.providerRequestIdBytes,
    }),
  });
}

function normalizeTiming(value) {
  const object = requireExactKeys(value, ['completedAt', 'totalMs', 'providerMs'], [], 'timing');
  const totalMs = normalizeInteger(object.totalMs, {
    label: 'timing.totalMs', minimum: 0, maximum: VISION_ADVICE_LIMITS.timingMs,
  });
  const providerMs = normalizeInteger(object.providerMs, {
    label: 'timing.providerMs', minimum: 0, maximum: VISION_ADVICE_LIMITS.timingMs, nullable: true,
  });
  if (providerMs !== null && providerMs > totalMs) fail('timing.providerMs must not exceed timing.totalMs.');
  return deepFreeze({ completedAt: normalizeCanonicalDate(object.completedAt), totalMs, providerMs });
}

function nullableTokenCount(value, label) {
  return normalizeInteger(value, {
    label, minimum: 0, maximum: VISION_ADVICE_LIMITS.tokenCount, nullable: true,
  });
}

export function normalizeVisionUsage(value) {
  if (value === null || value === undefined) return null;
  const object = requireExactKeys(
    value,
    ['inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens', 'cachedInputTokens'],
    [],
    'usage',
  );
  const usage = {
    inputTokens: nullableTokenCount(object.inputTokens, 'usage.inputTokens'),
    outputTokens: nullableTokenCount(object.outputTokens, 'usage.outputTokens'),
    totalTokens: nullableTokenCount(object.totalTokens, 'usage.totalTokens'),
    reasoningTokens: nullableTokenCount(object.reasoningTokens, 'usage.reasoningTokens'),
    cachedInputTokens: nullableTokenCount(object.cachedInputTokens, 'usage.cachedInputTokens'),
  };
  if (usage.inputTokens !== null && usage.outputTokens !== null && usage.totalTokens !== null
    && usage.inputTokens + usage.outputTokens !== usage.totalTokens) {
    fail('usage.totalTokens must equal inputTokens plus outputTokens when all three are present.');
  }
  return deepFreeze(usage);
}

function assertRequestDigest(value) {
  if (typeof value !== 'string' || !DIGEST_RE.test(value)) fail('requestDigest must be a lowercase SHA-256 digest.');
  return value;
}

function assertDocumentBytes(document) {
  const bytes = byteLength(JSON.stringify(document));
  if (bytes > VISION_ADVICE_LIMITS.normalizedDocumentBytes) {
    fail('Normalized vision advice exceeds its total UTF-8 byte limit.', 'VISION_ADVICE_LIMIT_EXCEEDED', {
      bytes, maxBytes: VISION_ADVICE_LIMITS.normalizedDocumentBytes,
    });
  }
  return document;
}

export function buildVisionAdviceDocument({
  requestDigest,
  operational,
  provider,
  timing,
  usage = null,
  advice = null,
} = {}) {
  const normalizedOperational = normalizeOperational(operational);
  const normalizedAdvice = advice === null ? null : normalizeVisionAdvicePayload(advice);
  if (normalizedOperational.status === 'ok' && normalizedAdvice === null) {
    fail('Successful vision advice requires an advice payload.');
  }
  if (normalizedOperational.status !== 'ok' && normalizedAdvice !== null) {
    fail('Operational failure must use advice: null.');
  }
  return deepFreeze(assertDocumentBytes({
    $schema: VISION_ADVICE_SCHEMA,
    schemaVersion: VISION_ADVICE_SCHEMA_VERSION,
    authority: VISION_ADVICE_AUTHORITY,
    requestDigest: assertRequestDigest(requestDigest),
    operational: normalizedOperational,
    provider: normalizeProvider(provider),
    timing: normalizeTiming(timing),
    usage: normalizeVisionUsage(usage),
    advice: normalizedAdvice,
  }));
}

export function buildVisionOperationalStatus({
  status,
  httpStatus = null,
  providerCode = null,
  diagnostic = status === 'ok' ? null : OPERATIONAL_DIAGNOSTICS[status],
} = {}) {
  return normalizeOperational({
    status,
    httpStatus,
    providerCode,
    retryable: RETRYABLE_STATUSES.has(status),
    diagnostic,
  });
}

function fixedFailure(status, { httpStatus = null, providerCode = null } = {}) {
  return buildVisionOperationalStatus({
    status,
    httpStatus,
    providerCode,
    diagnostic: OPERATIONAL_DIAGNOSTICS[status],
  });
}

export function mapVisionOperationalFailure({
  httpStatus = null,
  error = null,
  deadlineExceeded = false,
  cancelled = false,
  responseTooLarge = false,
  invalidResponse = false,
  cloudflareFailure = false,
} = {}) {
  if (cancelled || (!deadlineExceeded && error?.name === 'AbortError')) {
    return fixedFailure('cancelled', { providerCode: 'CALLER_CANCELLED' });
  }
  if (deadlineExceeded) return fixedFailure('timeout', { httpStatus, providerCode: 'DEADLINE_EXCEEDED' });
  if (responseTooLarge) return fixedFailure('response-too-large', { httpStatus, providerCode: 'RESPONSE_TOO_LARGE' });
  if (invalidResponse) return fixedFailure('invalid-response', { httpStatus, providerCode: 'INVALID_RESPONSE' });
  if (httpStatus === 401) return fixedFailure('auth-error', { httpStatus, providerCode: 'HTTP_401' });
  if (httpStatus === 403) return fixedFailure('permission-error', { httpStatus, providerCode: 'HTTP_403' });
  if (httpStatus === 408) return fixedFailure('timeout', { httpStatus, providerCode: 'HTTP_408' });
  if (httpStatus === 413) return fixedFailure('invalid-request', { httpStatus, providerCode: 'HTTP_413' });
  if (httpStatus === 429) return fixedFailure('rate-limited', { httpStatus, providerCode: 'HTTP_429' });
  if (Number.isInteger(httpStatus) && httpStatus >= 500 && httpStatus <= 599) {
    return fixedFailure('unavailable', { httpStatus, providerCode: 'HTTP_5XX' });
  }
  if (Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 499) {
    return fixedFailure('invalid-request', { httpStatus, providerCode: 'HTTP_4XX' });
  }
  if (cloudflareFailure) return fixedFailure('unavailable', { httpStatus, providerCode: 'CLOUDFLARE_FAILURE' });
  if (error && (NETWORK_ERROR_CODES.has(error.code) || error.name === 'TypeError')) {
    return fixedFailure('transport-error', { providerCode: 'TRANSPORT_FAILURE' });
  }
  return fixedFailure('invalid-response', { httpStatus, providerCode: 'INVALID_RESPONSE' });
}

function chunkToBuffer(chunk) {
  if (typeof chunk === 'string') return Buffer.from(chunk, 'utf8');
  if (chunk instanceof Uint8Array) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  if (chunk instanceof ArrayBuffer) return Buffer.from(chunk);
  if (ArrayBuffer.isView(chunk)) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  fail('Provider response stream yielded an unsupported chunk.', 'INVALID_VISION_PROVIDER_RESPONSE');
}

async function* responseChunks(source) {
  const body = source?.body ?? source;
  if (typeof body === 'string' || body instanceof Uint8Array || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    yield body;
    return;
  }
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield value;
      }
    } finally {
      reader.releaseLock?.();
    }
    return;
  }
  if (body && typeof body[Symbol.asyncIterator] === 'function') {
    yield* body;
    return;
  }
  if (body && typeof body[Symbol.iterator] === 'function') {
    yield* body;
    return;
  }
  fail('Provider response must be bytes or a byte stream.', 'INVALID_VISION_PROVIDER_RESPONSE');
}

export async function collectVisionResponseBytes(source, { maxBytes = VISION_ADVICE_LIMITS.rawResponseBytes } = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > VISION_ADVICE_LIMITS.rawResponseBytes) {
    fail('maxBytes is outside the vision response limit.', 'INVALID_VISION_ADVICE_ARGUMENT');
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of responseChunks(source)) {
    const bytes = chunkToBuffer(chunk);
    if (bytes.length > maxBytes - total) {
      fail('Provider response exceeds the raw byte limit.', 'VISION_PROVIDER_RESPONSE_TOO_LARGE', {
        bytes: total + bytes.length,
        maxBytes,
      });
    }
    total += bytes.length;
    chunks.push(Buffer.from(bytes));
  }
  return Buffer.concat(chunks, total);
}

function decodeFatalUtf8(bytes) {
  try {
    return FATAL_UTF8.decode(bytes);
  } catch (cause) {
    fail('Provider response is not valid UTF-8.', 'INVALID_VISION_PROVIDER_RESPONSE', undefined, cause);
  }
}

function parseJsonWithoutDuplicateKeys(text, label) {
  let index = 0;
  const length = text.length;

  function syntax(message) {
    fail(`${label} is not valid JSON.`, 'INVALID_VISION_PROVIDER_RESPONSE', { reason: message, offset: index });
  }

  function skipWhitespace() {
    while (index < length && /[\u0020\u0009\u000a\u000d]/u.test(text[index])) index += 1;
  }

  function parseString() {
    const start = index;
    if (text[index] !== '"') syntax('expected string');
    index += 1;
    let escaped = false;
    while (index < length) {
      const code = text.charCodeAt(index);
      if (!escaped && code === 0x22) {
        index += 1;
        const literal = text.slice(start, index);
        try {
          return JSON.parse(literal);
        } catch {
          syntax('invalid string escape');
        }
      }
      if (!escaped && code < 0x20) syntax('unescaped control in string');
      if (!escaped && code === 0x5c) escaped = true;
      else escaped = false;
      index += 1;
    }
    syntax('unterminated string');
  }

  function parseNumber() {
    const match = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/uy;
    match.lastIndex = index;
    const result = match.exec(text);
    if (!result) syntax('invalid number');
    index = match.lastIndex;
    const number = Number(result[0]);
    if (!Number.isFinite(number)) syntax('non-finite number');
    return number;
  }

  function parseArray(path) {
    index += 1;
    skipWhitespace();
    const array = [];
    if (text[index] === ']') {
      index += 1;
      return array;
    }
    while (index < length) {
      array.push(parseValue(`${path}[${array.length}]`));
      skipWhitespace();
      if (text[index] === ']') {
        index += 1;
        return array;
      }
      if (text[index] !== ',') syntax('expected comma in array');
      index += 1;
      skipWhitespace();
    }
    syntax('unterminated array');
  }

  function parseObject(path) {
    index += 1;
    skipWhitespace();
    const object = {};
    if (text[index] === '}') {
      index += 1;
      return object;
    }
    while (index < length) {
      const key = parseString();
      if (Object.hasOwn(object, key)) {
        fail(`${label} contains a duplicate JSON object key.`, 'INVALID_VISION_PROVIDER_RESPONSE', {
          key,
          path,
        });
      }
      skipWhitespace();
      if (text[index] !== ':') syntax('expected colon in object');
      index += 1;
      object[key] = parseValue(`${path}.${key}`);
      skipWhitespace();
      if (text[index] === '}') {
        index += 1;
        return object;
      }
      if (text[index] !== ',') syntax('expected comma in object');
      index += 1;
      skipWhitespace();
    }
    syntax('unterminated object');
  }

  function parseValue(path) {
    skipWhitespace();
    const character = text[index];
    if (character === '{') return parseObject(path);
    if (character === '[') return parseArray(path);
    if (character === '"') return parseString();
    if (character === '-' || /\d/u.test(character ?? '')) return parseNumber();
    if (text.startsWith('true', index)) {
      index += 4;
      return true;
    }
    if (text.startsWith('false', index)) {
      index += 5;
      return false;
    }
    if (text.startsWith('null', index)) {
      index += 4;
      return null;
    }
    syntax('unexpected token');
  }

  const value = parseValue('$');
  skipWhitespace();
  if (index !== length) syntax('trailing data');
  return value;
}

function rawBodyToText(rawBody) {
  let bytes;
  if (typeof rawBody === 'string') bytes = Buffer.from(rawBody, 'utf8');
  else if (rawBody instanceof Uint8Array) bytes = Buffer.from(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength);
  else if (rawBody instanceof ArrayBuffer) bytes = Buffer.from(rawBody);
  else fail('Provider response must be a string or Uint8Array.', 'INVALID_VISION_PROVIDER_RESPONSE');
  if (bytes.byteLength > VISION_ADVICE_LIMITS.rawResponseBytes) {
    fail('Provider response exceeds the raw byte limit.', 'VISION_PROVIDER_RESPONSE_TOO_LARGE', {
      bytes: bytes.byteLength,
      maxBytes: VISION_ADVICE_LIMITS.rawResponseBytes,
    });
  }
  return decodeFatalUtf8(bytes);
}

function parseJson(value, label) {
  return parseJsonWithoutDuplicateKeys(value, label);
}

function stripSingleJsonFence(value) {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  return match ? match[1] : trimmed;
}

function pickCompletionRoot(payload) {
  const candidates = [payload, payload?.result, payload?.result?.response]
    .filter(isPlainObject)
    .filter((candidate) => Array.isArray(candidate.choices));
  const unique = [...new Set(candidates)];
  if (unique.length !== 1) {
    fail('Provider response must contain exactly one completion envelope.', 'INVALID_VISION_PROVIDER_RESPONSE', {
      completionEnvelopes: unique.length,
    });
  }
  return unique[0];
}

function extractUsage(payload, completionRoot) {
  const usage = completionRoot?.usage ?? payload?.result?.usage ?? payload?.usage;
  if (!isPlainObject(usage)) return null;
  const details = isPlainObject(usage.completion_tokens_details) ? usage.completion_tokens_details : {};
  const promptDetails = isPlainObject(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  return normalizeVisionUsage({
    inputTokens: Number.isInteger(usage.prompt_tokens) ? usage.prompt_tokens : null,
    outputTokens: Number.isInteger(usage.completion_tokens) ? usage.completion_tokens : null,
    totalTokens: Number.isInteger(usage.total_tokens) ? usage.total_tokens : null,
    reasoningTokens: Number.isInteger(details.reasoning_tokens) ? details.reasoning_tokens : null,
    cachedInputTokens: Number.isInteger(promptDetails.cached_tokens) ? promptDetails.cached_tokens : null,
  });
}

function textContent(message) {
  if (typeof message.content === 'string' && message.content.trim().length > 0) return message.content;
  if (!Array.isArray(message.content)) return null;
  const textParts = message.content.map((part) => {
    if (typeof part === 'string') return part;
    if (isPlainObject(part) && typeof part.text === 'string') return part.text;
    return null;
  }).filter((part) => typeof part === 'string' && part.trim().length > 0);
  return textParts.length > 0 ? textParts.join('\n') : null;
}

function toolCalls(message) {
  const calls = [];
  if (message.tool_calls !== undefined) {
    if (!Array.isArray(message.tool_calls)) fail('message.tool_calls must be an array.', 'INVALID_VISION_PROVIDER_RESPONSE');
    calls.push(...message.tool_calls);
  }
  if (message.function_call !== undefined && message.function_call !== null) {
    calls.push({ function: message.function_call });
  }
  return calls;
}

function extractStructuredPayload(message, { outputMode }) {
  const channels = [];
  if (message.parsed !== undefined && message.parsed !== null) {
    if (!isPlainObject(message.parsed)) fail('message.parsed must be an object.', 'INVALID_VISION_PROVIDER_RESPONSE');
    channels.push({ channel: 'message.parsed', value: message.parsed });
  }
  if (isPlainObject(message.content)) channels.push({ channel: 'message.content-object', value: message.content });
  const text = textContent(message);
  if (text !== null) channels.push({ channel: 'message.content-text', value: text });
  const calls = toolCalls(message);
  if (calls.length > 0) channels.push({ channel: 'tool-call', value: calls });

  if (channels.length !== 1) {
    fail('Provider response must populate exactly one structured-output channel.', 'INVALID_VISION_PROVIDER_RESPONSE', {
      channels: channels.map((item) => item.channel),
    });
  }
  const selected = channels[0];
  if (outputMode === 'function' && selected.channel !== 'tool-call') {
    fail('Function output mode requires one tool-call channel.', 'INVALID_VISION_PROVIDER_RESPONSE', {
      channel: selected.channel,
    });
  }
  if (outputMode === 'json-schema' && selected.channel === 'tool-call') {
    fail('JSON-schema output mode cannot use a tool-call channel.', 'INVALID_VISION_PROVIDER_RESPONSE');
  }

  if (selected.channel === 'tool-call') {
    const callsValue = selected.value;
    if (callsValue.length !== 1) {
      fail('Provider response must contain exactly one tool call.', 'INVALID_VISION_PROVIDER_RESPONSE', {
        toolCalls: callsValue.length,
      });
    }
    const call = callsValue[0];
    const name = call?.function?.name ?? call?.name;
    if (name !== VISION_ADVICE_TOOL_NAME) {
      fail('Provider response contains an unsupported tool call.', 'INVALID_VISION_PROVIDER_RESPONSE');
    }
    const args = call?.function?.arguments ?? call?.arguments;
    if (isPlainObject(args)) return { channel: selected.channel, payload: args };
    if (typeof args !== 'string') fail('Vision advice function arguments are missing.', 'INVALID_VISION_PROVIDER_RESPONSE');
    return { channel: selected.channel, payload: parseJson(args, 'Vision advice function arguments') };
  }
  if (selected.channel === 'message.content-text') {
    return { channel: selected.channel, payload: parseJson(stripSingleJsonFence(selected.value), 'Vision advice content') };
  }
  return { channel: selected.channel, payload: selected.value };
}

export function parseCloudflareVisionAdviceResponse(rawBody, { outputMode = 'json-schema' } = {}) {
  if (!['json-schema', 'function'].includes(outputMode)) {
    fail('outputMode must be json-schema or function.', 'INVALID_VISION_ADVICE_ARGUMENT');
  }
  const payload = parseJson(rawBodyToText(rawBody), 'Provider response');
  if (!isPlainObject(payload)) fail('Provider response must be a JSON object.', 'INVALID_VISION_PROVIDER_RESPONSE');
  if (payload.success === false) {
    const operational = mapVisionOperationalFailure({
      cloudflareFailure: true,
      httpStatus: Number.isInteger(payload.status) ? payload.status : null,
    });
    fail('Cloudflare reported an unsuccessful provider response.', 'VISION_PROVIDER_OPERATIONAL_FAILURE', { operational });
  }
  const completionRoot = pickCompletionRoot(payload);
  if (completionRoot.choices.length !== 1) {
    fail('Provider response must contain exactly one completion choice.', 'INVALID_VISION_PROVIDER_RESPONSE', {
      choices: completionRoot.choices.length,
    });
  }
  const choice = completionRoot.choices[0];
  const finishReason = choice?.finish_reason ?? completionRoot.finish_reason ?? null;
  if (!SUCCESS_FINISH_REASONS.has(finishReason)) {
    fail('Provider response ended with an unsupported finish reason.', 'INVALID_VISION_PROVIDER_RESPONSE', { finishReason });
  }
  const message = choice?.message;
  if (!isPlainObject(message)) fail('Provider completion has no assistant message.', 'INVALID_VISION_PROVIDER_RESPONSE');
  if (typeof message.refusal === 'string' && message.refusal.trim().length > 0) {
    fail('Provider refused the vision advice request.', 'INVALID_VISION_PROVIDER_RESPONSE');
  }
  const selected = extractStructuredPayload(message, { outputMode });
  if (selected.channel === 'tool-call' && !['tool_calls', 'function_call'].includes(finishReason)) {
    fail('Tool-call output requires a tool-call finish reason.', 'INVALID_VISION_PROVIDER_RESPONSE');
  }
  if (selected.channel !== 'tool-call' && finishReason !== 'stop') {
    fail('JSON output requires the stop finish reason.', 'INVALID_VISION_PROVIDER_RESPONSE');
  }
  const advice = normalizeVisionAdvicePayload(selected.payload);
  return deepFreeze({
    advice,
    channel: selected.channel,
    usage: extractUsage(payload, completionRoot),
    finishReason,
    model: normalizeNullableText(
      typeof completionRoot.model === 'string' ? completionRoot.model : payload.model,
      { label: 'provider response model', maxBytes: VISION_ADVICE_LIMITS.modelIdBytes },
    ),
    responseId: normalizeNullableText(
      typeof completionRoot.id === 'string' ? completionRoot.id : payload.id,
      { label: 'provider response id', maxBytes: VISION_ADVICE_LIMITS.providerRequestIdBytes },
    ),
    systemFingerprint: normalizeNullableText(completionRoot.system_fingerprint, {
      label: 'provider system fingerprint', maxBytes: VISION_ADVICE_LIMITS.systemFingerprintBytes,
    }),
  });
}

export async function parseCloudflareVisionAdviceStream(source, options = {}) {
  const bytes = await collectVisionResponseBytes(source);
  return parseCloudflareVisionAdviceResponse(bytes, options);
}
