import test from 'node:test';
import assert from 'node:assert/strict';
import { isSameOrigin } from '../src/browser/review.mjs';

test('accepts same-origin paths and redirects', () => {
  assert.equal(isSameOrigin('https://example.com', 'https://example.com/path?q=1'), true);
  assert.equal(isSameOrigin('http://127.0.0.1:4173', 'http://127.0.0.1:4173/ready'), true);
});

test('rejects scheme, host, and port changes', () => {
  assert.equal(isSameOrigin('https://example.com', 'http://example.com/path'), false);
  assert.equal(isSameOrigin('https://example.com', 'https://other.example/path'), false);
  assert.equal(isSameOrigin('http://127.0.0.1:4173', 'http://127.0.0.1:4174/path'), false);
  assert.equal(isSameOrigin('https://example.com', 'not a url'), false);
});
