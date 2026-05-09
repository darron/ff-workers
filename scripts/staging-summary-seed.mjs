#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function arg(name, fallback = '') {
  const prefix = `--${name}=`;
  const found = process.argv.find(value => value.startsWith(prefix));
  if (found) return found.slice(prefix.length) || fallback;
  return process.env[name.toUpperCase().replaceAll('-', '_')] || fallback;
}

function uuidFrom(input, salt = '') {
  const hex = createHash('sha256').update(`${salt}:${input}`).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32)
  ].join('-');
}

function sqlString(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

const url = arg('url');
if (!url) {
  console.error('Pass --url=... or URL=...');
  process.exit(2);
}
const urls = url.split(/\s*,\s*/).map(value => value.trim()).filter(Boolean);

const recordId = arg('record-id', uuidFrom(url, 'record'));
const name = arg('name', 'Staging Summary Test');
const city = arg('city', 'Brockville');
const province = arg('province', 'ON');
const date = arg('date', '2026');
const victims = arg('victims', '3');
const deaths = arg('deaths', '3');
const injuries = arg('injuries', '0');
const devices = arg('devices', 'Unknown');
const storyInserts = urls.map((storyUrl, index) => {
  const storyId = uuidFrom(storyUrl, `story-${index}`);
  const canonicalUrl = `${storyUrl}${storyUrl.includes('#') ? '&' : '#'}staging-summary-test-${recordId}-${index}`;
  return `INSERT INTO news_stories (id, record_id, url, canonical_url, body_text, ai_summary)
VALUES (${sqlString(storyId)}, ${sqlString(recordId)}, ${sqlString(storyUrl)}, ${sqlString(canonicalUrl)}, NULL, NULL);`;
}).join('\n\n');

const sql = `
DELETE FROM news_stories WHERE record_id = ${sqlString(recordId)};
DELETE FROM records WHERE id = ${sqlString(recordId)};

INSERT INTO records (
  id, date, name, city, province, licensed, victims, deaths, injuries, suicide,
  devices_used, firearms, possessed_legally, warnings, oic_impact, ai_summary
) VALUES (
  ${sqlString(recordId)}, ${sqlString(date)}, ${sqlString(name)}, ${sqlString(city)}, ${sqlString(province)},
  NULL, ${Number.parseInt(victims, 10) || 0}, ${Number.parseInt(deaths, 10) || 0}, ${Number.parseInt(injuries, 10) || 0}, NULL,
  ${sqlString(devices)}, NULL, NULL, NULL, NULL, NULL
);

${storyInserts}
`;

const file = join(tmpdir(), `ff-workers-staging-summary-${recordId}.sql`);
writeFileSync(file, sql);
console.log(file);
