const SITEMAP_ORIGIN = 'https://massmurdercanada.org';
const SITEMAP_NAMESPACE = 'http://www.sitemaps.org/schemas/sitemap/0.9';

const GROUP_ROUTES = [
  'mass',
  'massother',
  'massfirearms',
  'massfirearmslicensed',
  'oic',
  'suicide'
];

const VALID_PROVINCES = new Set([
  'BC', 'AB', 'ON', 'NT', 'YT', 'NB', 'NL', 'NS', 'PE', 'QC', 'MB', 'SK', 'NU', 'USA'
]);

export const SITEMAP_URL = `${SITEMAP_ORIGIN}/sitemap.xml`;

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSitemapUrls(records = []) {
  const urls = new Set([
    `${SITEMAP_ORIGIN}/`,
    `${SITEMAP_ORIGIN}/map/canada`,
    ...GROUP_ROUTES.map((group) => `${SITEMAP_ORIGIN}/records/group/${group}`)
  ]);

  for (const record of records) {
    if (!record?.id) {
      continue;
    }

    urls.add(`${SITEMAP_ORIGIN}/records/${encodeURIComponent(String(record.id))}`);

    const province = String(record.province || '').toUpperCase();
    if (VALID_PROVINCES.has(province)) {
      urls.add(`${SITEMAP_ORIGIN}/records/provinces/${province.toLowerCase()}`);
    }
  }

  return [...urls].sort();
}

export function renderSitemapXml(records) {
  const entries = buildSitemapUrls(records).map((url) => [
    '  <url>',
    `    <loc>${escapeXml(url)}</loc>`,
    '  </url>'
  ].join('\n'));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<urlset xmlns="${SITEMAP_NAMESPACE}">`,
    ...entries,
    '</urlset>',
    ''
  ].join('\n');
}
