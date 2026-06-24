#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const html = readFileSync(0, 'utf8');

function decodeHtml(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function cleanText(fragment) {
  return decodeHtml(String(fragment || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(pattern) {
  return html.match(pattern)?.[1] || '';
}

const recordTitle = cleanText(firstMatch(/<h2>([\s\S]*?)<\/h2>/i));
const credibility = cleanText(firstMatch(/<div class="credibility-note[^"]*">([\s\S]*?)<\/div>/i));
const aiSummary = firstMatch(/<div class="ai-summary-text">([\s\S]*?)<\/div>/i);
const aiClassification = cleanText(
  aiSummary.match(/<strong>\s*Classification:\s*<\/strong>\s*([^<]+)/i)?.[1] || ''
);

const rowHtml = firstMatch(/<tbody>\s*<tr>([\s\S]*?)<\/tr>\s*<\/tbody>/i);
const cells = [...rowHtml.matchAll(/<td>([\s\S]*?)<\/td>/gi)].map(match => cleanText(match[1]));
const labels = ['Date', 'Name', 'City', 'Province', 'Licensed', 'Victims', 'Deaths', 'Injuries', 'Suicide', 'Firearms', 'OIC Impact'];
const recordFields = labels
  .map((label, index) => [label, cells[index] || ''])
  .filter(([label]) => ['Date', 'Name', 'City', 'Province', 'Victims', 'Deaths', 'Injuries', 'Firearms'].includes(label));

const badges = [...html.matchAll(/<span class="source-badge [^"]*">([\s\S]*?)<\/span>/gi)]
  .map(match => cleanText(match[1]));
const urls = [...html.matchAll(/<div><a href="([^"]+)" target="_blank"/gi)]
  .map(match => decodeHtml(match[1]));

if (!recordTitle) {
  console.error('Could not find a record title in the rendered page.');
  process.exit(1);
}

console.log(`Record: ${recordTitle}`);
if (recordFields.length > 0) {
  console.log(`Fields: ${recordFields.map(([label, value]) => `${label}=${value}`).join(' | ')}`);
}
if (aiClassification) {
  console.log(`AI classification: ${aiClassification}`);
}
if (credibility) {
  console.log(`Credibility: ${credibility}`);
}
console.log(`Sources: ${urls.length}`);
urls.forEach((url, index) => {
  console.log(`- ${badges[index] || 'Unknown'}: ${url}`);
});
