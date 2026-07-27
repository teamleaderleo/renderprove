import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';
import { RenderproveError } from '../core/errors.mjs';
import * as base from './advice-base.mjs';

export const VISION_ADVICE_SCHEMA_VERSION = base.VISION_ADVICE_SCHEMA_VERSION;
export const VISION_ADVICE_PAYLOAD_VERSION = base.VISION_ADVICE_PAYLOAD_VERSION;
export const VISION_ADVICE_AUTHORITY = base.VISION_ADVICE_AUTHORITY;
export const VISION_ADVICE_TOOL_NAME = base.VISION_ADVICE_TOOL_NAME;
export const VISION_ADVICE_SCHEMA = base.VISION_ADVICE_SCHEMA;
export const VISION_ADVICE_PAYLOAD_SCHEMA = base.VISION_ADVICE_PAYLOAD_SCHEMA;
export const VISION_ADVICE_LIMITS = base.VISION_ADVICE_LIMITS;
export const VISION_OPERATIONAL_STATUSES = base.VISION_OPERATIONAL_STATUSES;
export const VISION_PROVIDER_CODES = base.VISION_PROVIDER_CODES;
export const normalizeVisionAdvicePayload = base.normalizeVisionAdvicePayload;
export const normalizeVisionUsage = base.normalizeVisionUsage;
export const buildVisionOperationalStatus = base.buildVisionOperationalStatus;
export const mapVisionOperationalFailure = base.mapVisionOperationalFailure;

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const SAFE_KEYS = new Set(['choices', 'assessment', 'risks']);
const RETRYABLE = new Set(['timeout', 'rate-limited', 'unavailable', 'transport-error']);
const DIAGNOSTIC = Object.freeze({
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

function fail(message, code = 'INVALID_VISION_ADVICE', details, cause) {
  throw new RenderproveError(message, { code, details, cause });
}

function strictJson(text, label) {
  let i = 0;
  const ws = () => { while (/\s/u.test(text[i] ?? '')) i += 1; };
  const syntax = (reason) => fail(`${label} is not valid JSON.`, 'INVALID_VISION_PROVIDER_RESPONSE', { reason, offset: i });
  const string = () => {
    const start = i;
    if (text[i] !== '"') syntax('expected-string');
    i += 1;
    let escaped = false;
    while (i < text.length) {
      const code = text.charCodeAt(i);
      if (!escaped && code === 0x22) {
        i += 1;
        try { return JSON.parse(text.slice(start, i)); } catch { syntax('invalid-string'); }
      }
      if (!escaped && code < 0x20) syntax('unescaped-control');
      escaped = !escaped && code === 0x5c;
      i += 1;
    }
    syntax('unterminated-string');
  };
  const number = () => {
    const re = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/uy;
    re.lastIndex = i;
    const match = re.exec(text);
    if (!match) syntax('invalid-number');
    i = re.lastIndex;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) syntax('non-finite-number');
    return value;
  };
  const value = () => {
    ws();
    if (text[i] === '{') return object();
    if (text[i] === '[') return array();
    if (text[i] === '"') return string();
    if (text[i] === '-' || /\d/u.test(text[i] ?? '')) return number();
    for (const [token, result] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(token, i)) { i += token.length; return result; }
    }
    syntax('unexpected-token');
  };
  const array = () => {
    i += 1; ws();
    const result = [];
    if (text[i] === ']') { i += 1; return result; }
    while (i < text.length) {
      result.push(value()); ws();
      if (text[i] === ']') { i += 1; return result; }
      if (text[i] !== ',') syntax('expected-array-comma');
      i += 1; ws();
    }
    syntax('unterminated-array');
  };
  const object = () => {
    i += 1; ws();
    const result = Object.create(null);
    const keys = new Set();
    if (text[i] === '}') { i += 1; return result; }
    while (i < text.length) {
      const key = string();
      if (keys.has(key)) {
        const details = { reason: 'duplicate-object-key' };
        if (SAFE_KEYS.has(key)) details.key = key;
        fail(`${label} contains a duplicate JSON object key.`, 'INVALID_VISION_PROVIDER_RESPONSE', details);
      }
      keys.add(key); ws();
      if (text[i] !== ':') syntax('expected-object-colon');
      i += 1;
      Object.defineProperty(result, key, {
        value: value(), enumerable: true, writable: true, configurable: true,
      });
      ws();
      if (text[i] === '}') { i += 1; return result; }
      if (text[i] !== ',') syntax('expected-object-comma');
      i += 1; ws();
    }
    syntax('unterminated-object');
  };
  const result = value();
  ws();
  if (i !== text.length) syntax('trailing-data');
  return result;
}

function textOf(raw) {
  let bytes;
  if (typeof raw === 'string') bytes = Buffer.from(raw, 'utf8');
  else if (raw instanceof Uint8Array) bytes = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  else if (raw instanceof ArrayBuffer) bytes = Buffer.from(raw);
  else fail('Provider response must be a string or bytes.', 'INVALID_VISION_PROVIDER_RESPONSE');
  if (bytes.byteLength > VISION_ADVICE_LIMITS.rawResponseBytes) {
    fail('Provider response exceeds the raw byte limit.', 'VISION_PROVIDER_RESPONSE_TOO_LARGE', {
      bytes: bytes.byteLength, maxBytes: VISION_ADVICE_LIMITS.rawResponseBytes,
    });
  }
  try { return UTF8.decode(bytes); } catch (cause) {
    fail('Provider response is not valid UTF-8.', 'INVALID_VISION_PROVIDER_RESPONSE', undefined, cause);
  }
}

function stripFence(text) {
  const trimmed = text.trim();
  return /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed)?.[1] ?? trimmed;
}

function preflightNested(value) {
  if (Array.isArray(value)) { for (const item of value) preflightNested(item); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'arguments' && typeof child === 'string') strictJson(child, 'Vision advice function arguments');
    else if (key === 'content' && typeof child === 'string') {
      const candidate = stripFence(child);
      if (/^[{[]/u.test(candidate.trim())) strictJson(candidate, 'Vision advice content');
    }
    preflightNested(child);
  }
}

function preflight(raw) {
  const parsed = strictJson(textOf(raw), 'Provider response');
  preflightNested(parsed);
}

function validOperational(o) {
  if (!o || typeof o !== 'object' || o.retryable !== RETRYABLE.has(o.status)
      || o.diagnostic !== DIAGNOSTIC[o.status]) return false;
  const http = (min, max) => Number.isInteger(o.httpStatus) && o.httpStatus >= min && o.httpStatus <= max;
  switch (o.status) {
    case 'ok': return o.providerCode === null && (o.httpStatus === null || http(200, 299));
    case 'auth-error': return o.providerCode === 'HTTP_401' && o.httpStatus === 401;
    case 'permission-error': return o.providerCode === 'HTTP_403' && o.httpStatus === 403;
    case 'invalid-request': return (o.providerCode === 'HTTP_413' && o.httpStatus === 413)
      || (o.providerCode === 'HTTP_4XX' && http(400, 499) && ![401, 403, 408, 413, 429].includes(o.httpStatus));
    case 'timeout': return (o.providerCode === 'HTTP_408' && o.httpStatus === 408)
      || o.providerCode === 'DEADLINE_EXCEEDED';
    case 'rate-limited': return o.providerCode === 'HTTP_429' && o.httpStatus === 429;
    case 'unavailable': return (o.providerCode === 'HTTP_5XX' && http(500, 599))
      || o.providerCode === 'CLOUDFLARE_FAILURE';
    case 'transport-error': return o.providerCode === 'TRANSPORT_FAILURE' && o.httpStatus === null;
    case 'response-too-large': return o.providerCode === 'RESPONSE_TOO_LARGE';
    case 'invalid-response': return o.providerCode === 'INVALID_RESPONSE';
    case 'cancelled': return o.providerCode === 'CALLER_CANCELLED' && o.httpStatus === null;
    default: return false;
  }
}

export function buildVisionAdviceDocument(options = {}) {
  if (!validOperational(options.operational)) fail('Operational metadata does not match the status policy.');
  return base.buildVisionAdviceDocument(options);
}

function chunkBuffer(chunk) {
  if (typeof chunk === 'string') return Buffer.from(chunk, 'utf8');
  if (chunk instanceof Uint8Array) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  if (chunk instanceof ArrayBuffer) return Buffer.from(chunk);
  if (ArrayBuffer.isView(chunk)) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  fail('Provider response stream yielded an unsupported chunk.', 'INVALID_VISION_PROVIDER_RESPONSE');
}

async function* chunks(source) {
  const body = source?.body ?? source;
  if (typeof body === 'string' || body instanceof Uint8Array || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    yield body; return;
  }
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    let completed = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { completed = true; break; }
        yield value;
      }
    } finally {
      if (!completed) try { await reader.cancel?.(); } catch { /* preserve original failure */ }
      reader.releaseLock?.();
    }
    return;
  }
  if (body && typeof body[Symbol.asyncIterator] === 'function') { yield* body; return; }
  if (body && typeof body[Symbol.iterator] === 'function') { yield* body; return; }
  fail('Provider response must be bytes or a byte stream.', 'INVALID_VISION_PROVIDER_RESPONSE');
}

export async function collectVisionResponseBytes(source, { maxBytes = VISION_ADVICE_LIMITS.rawResponseBytes } = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > VISION_ADVICE_LIMITS.rawResponseBytes) {
    fail('maxBytes is outside the vision response limit.', 'INVALID_VISION_ADVICE_ARGUMENT');
  }
  const result = [];
  let total = 0;
  for await (const chunk of chunks(source)) {
    const bytes = chunkBuffer(chunk);
    if (bytes.length > maxBytes - total) {
      fail('Provider response exceeds the raw byte limit.', 'VISION_PROVIDER_RESPONSE_TOO_LARGE', {
        bytes: total + bytes.length, maxBytes,
      });
    }
    total += bytes.length;
    result.push(Buffer.from(bytes));
  }
  return Buffer.concat(result, total);
}

export function parseCloudflareVisionAdviceResponse(rawBody, options = {}) {
  preflight(rawBody);
  return base.parseCloudflareVisionAdviceResponse(rawBody, options);
}

export async function parseCloudflareVisionAdviceStream(source, options = {}) {
  return parseCloudflareVisionAdviceResponse(await collectVisionResponseBytes(source), options);
}
