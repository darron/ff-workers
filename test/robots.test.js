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
    'Sitemap: https://massmurdercanada.org/sitemap.xml',
    ''
  ].join('\n'));
});

test('serves a dynamic XML sitemap with canonical public URLs', async () => {
  const records = [{ id: 'first-record', province: 'AB' }];
  const env = {
    DB: {
      prepare() {
        return {
          all: async () => ({ results: records })
        };
      }
    }
  };

  const fetchSitemap = () => worker.fetch(
    new Request('https://massmurdercanada.org/sitemap.xml'),
    env,
    { waitUntil() {} }
  );

  let response = await fetchSitemap();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/xml; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=3600, s-maxage=3600');

  let body = await response.text();
  assert.match(body, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(body, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(body, /<loc>https:\/\/massmurdercanada\.org\/<\/loc>/);
  assert.match(body, /<loc>https:\/\/massmurdercanada\.org\/map\/canada<\/loc>/);
  assert.match(body, /<loc>https:\/\/massmurdercanada\.org\/records\/group\/mass<\/loc>/);
  assert.match(body, /<loc>https:\/\/massmurdercanada\.org\/records\/provinces\/ab<\/loc>/);
  assert.match(body, /<loc>https:\/\/massmurdercanada\.org\/records\/first-record<\/loc>/);
  assert.doesNotMatch(body, /\/admin/);

  records.push({ id: 'second-record', province: 'ON' });
  response = await fetchSitemap();
  body = await response.text();
  assert.match(body, /<loc>https:\/\/massmurdercanada\.org\/records\/second-record<\/loc>/);
  assert.match(body, /<loc>https:\/\/massmurdercanada\.org\/records\/provinces\/on<\/loc>/);
});
