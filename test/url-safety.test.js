import test from 'node:test';
import assert from 'node:assert/strict';

import { validateAndNormalizePublicHttpUrl } from '../src/url-safety.js';

test('public URL normalization strips fragments, tracking params, default ports, and trailing slash', () => {
  const result = validateAndNormalizePublicHttpUrl(
    'HTTPS://Example.COM:443/story/?utm_source=x&b=2&a=1#section'
  );

  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://example.com/story?a=1&b=2');
});

test('public URL validation blocks local targets, credentials, and non-standard ports', () => {
  assert.equal(validateAndNormalizePublicHttpUrl('http://localhost/story').ok, false);
  assert.equal(validateAndNormalizePublicHttpUrl('https://user:pass@example.com/story').ok, false);
  assert.equal(validateAndNormalizePublicHttpUrl('https://example.com:8443/story').ok, false);
  assert.equal(validateAndNormalizePublicHttpUrl('file:///tmp/story').ok, false);
});

test('public URL validation blocks private IPv6 targets', () => {
  assert.equal(validateAndNormalizePublicHttpUrl('http://[::1]/story').ok, false);
  assert.equal(validateAndNormalizePublicHttpUrl('http://[fd00::1]/story').ok, false);
  assert.equal(validateAndNormalizePublicHttpUrl('http://[::ffff:127.0.0.1]/story').ok, false);
});
