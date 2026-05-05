import test from 'node:test';
import assert from 'node:assert/strict';

import { safeFetchPublicText, validateAndNormalizePublicHttpUrl } from '../src/url-safety.js';

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

test('safe fetch preserves redirect target path shape after safety validation', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];

  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    if (String(url) === 'https://example.com/story') {
      return new Response('', {
        status: 301,
        headers: { Location: 'https://example.com/story/' }
      });
    }
    return new Response('ok', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    });
  };

  try {
    const result = await safeFetchPublicText('https://example.com/story', {
      requirePublicDns: false
    });

    assert.equal(result.ok, true);
    assert.equal(result.text, 'ok');
    assert.equal(result.finalUrl, 'https://example.com/story/');
    assert.deepEqual(requestedUrls, [
      'https://example.com/story',
      'https://example.com/story/'
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
