import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeManifest } from '../src/core/manifest.mjs';

const base = {
  version: 1,
  project: 'same-origin',
  target: { baseUrl: 'https://example.com' },
  review: { routes: ['/'] },
};

test('normalizes route queries and fragments without changing origin', () => {
  const manifest = normalizeManifest({ ...base, review: { routes: ['/search?q=grass#results'] } });
  assert.equal(manifest.review.routes[0].path, '/search?q=grass#results');
});

test('rejects protocol-relative and backslash-origin route escapes', () => {
  assert.throws(() => normalizeManifest({ ...base, review: { routes: ['//attacker.example/path'] } }), /declared origin/);
  assert.throws(() => normalizeManifest({ ...base, review: { routes: ['/\\attacker.example/path'] } }), /declared origin/);
});

test('rejects protocol-relative runtime readiness escapes', () => {
  assert.throws(() => normalizeManifest({
    ...base,
    target: undefined,
    runtime: { command: ['node', 'server.mjs'], port: 4173, readyPath: '//attacker.example/ready' },
  }), /declared origin/);
});

test('requires deployed targets to be origins', () => {
  assert.throws(() => normalizeManifest({ ...base, target: { baseUrl: 'https://example.com/app' } }), /without credentials, path, query, or fragment/);
  assert.throws(() => normalizeManifest({ ...base, target: { baseUrl: 'https://example.com/?token=secret' } }), /without credentials, path, query, or fragment/);
});
