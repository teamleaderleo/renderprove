import { RenderproveError } from '../core/errors.mjs';

export const DEFAULT_ADVICE_GENERATION = Object.freeze({
  responseMode: 'tool',
  maxCompletionTokens: 4_096,
  maxFindings: 6,
  maxEvidencePerFinding: 3,
  maxStrengths: 4,
  maxOmissions: 4,
});

const RESPONSE_MODES = Object.freeze(['tool', 'json-schema']);
const RANGES = Object.freeze({
  maxCompletionTokens: { min: 1_024, max: 4_096 },
  maxFindings: { min: 1, max: 10 },
  maxEvidencePerFinding: { min: 1, max: 8 },
  maxStrengths: { min: 0, max: 10 },
  maxOmissions: { min: 0, max: 10 },
});

export function normalizeAdviceGeneration(input = {}, {
  code = 'INVALID_ADVICE_ARGUMENT',
  label = 'advice generation',
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new RenderproveError(`${label} must be an object.`, { code });
  }
  const allowed = new Set(['responseMode', ...Object.keys(RANGES)]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new RenderproveError(`${label} contains unknown fields: ${unknown.join(', ')}.`, {
      code,
      details: { unknown },
    });
  }
  const responseMode = input.responseMode ?? DEFAULT_ADVICE_GENERATION.responseMode;
  if (!RESPONSE_MODES.includes(responseMode)) {
    throw new RenderproveError(`${label}.responseMode must be tool or json-schema.`, { code });
  }
  const normalized = { responseMode };
  for (const [key, range] of Object.entries(RANGES)) {
    const value = input[key] ?? DEFAULT_ADVICE_GENERATION[key];
    if (!Number.isInteger(value) || value < range.min || value > range.max) {
      throw new RenderproveError(`${label}.${key} must be an integer between ${range.min} and ${range.max}.`, {
        code,
      });
    }
    normalized[key] = value;
  }
  return Object.freeze(normalized);
}

export function buildAdvisoryResponseSchema(generationInput = DEFAULT_ADVICE_GENERATION) {
  const generation = normalizeAdviceGeneration(generationInput);
  return Object.freeze({
    type: 'object',
    additionalProperties: false,
    required: ['verdict', 'summary', 'findings', 'strengths', 'omissions'],
    properties: {
      verdict: { enum: ['clear', 'concern', 'unknown'] },
      summary: { type: 'string', minLength: 1, maxLength: 1_000 },
      findings: {
        type: 'array',
        maxItems: generation.maxFindings,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['severity', 'title', 'evidence', 'recommendation'],
          properties: {
            severity: { enum: ['info', 'warning', 'high'] },
            title: { type: 'string', minLength: 1, maxLength: 240 },
            evidence: {
              type: 'array',
              maxItems: generation.maxEvidencePerFinding,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['path', 'detail'],
                properties: {
                  path: { type: 'string', minLength: 1, maxLength: 500 },
                  detail: { type: 'string', minLength: 1, maxLength: 750 },
                },
              },
            },
            recommendation: { type: 'string', minLength: 1, maxLength: 750 },
          },
        },
      },
      strengths: {
        type: 'array',
        maxItems: generation.maxStrengths,
        items: { type: 'string', minLength: 1, maxLength: 400 },
      },
      omissions: {
        type: 'array',
        maxItems: generation.maxOmissions,
        items: { type: 'string', minLength: 1, maxLength: 400 },
      },
    },
  });
}
