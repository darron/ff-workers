import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';

test('serves robots.txt as plain text before requiring the database', async () => {
  const response = await worker.fetch(
    new Request('https://massmurdercanada.org/robots.txt'),
    {},
    { waitUntil() {} }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(await response.text(), [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /admin/',
    'Disallow: /admin/api/',
    ''
  ].join('\n'));
});
