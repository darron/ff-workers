import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __test,
  getCbcLiteUrl,
  getSourceUrlCandidates,
  normalizeSourceUrl,
  sanitizeExtractedText
} from '../src/ai-summary.js';

test('summary sanitizer removes extractor metadata and page chrome', () => {
  const raw = `--- description: A 17-year-old in Brockville, Ont., has been charged with murder.
image: https://example.com/photo.jpg ---
Home News Ontario window.articleTemplate = "article-advanced";
Share this Story : Brockville Recorder & Times Copy Link Email X Reddit Pinterest LinkedIn Tumblr
Teen charged with murder after mother, 2 daughters found dead in Brockville home.
A 49-year-old woman and her 17 and 15-year-old daughters are dead in what police called intimate partner violence.`;

  const sanitized = sanitizeExtractedText(raw);

  assert.match(sanitized, /Teen charged with murder/);
  assert.match(sanitized, /49-year-old woman/);
  assert.doesNotMatch(sanitized, /window\.articleTemplate/);
  assert.doesNotMatch(sanitized, /Share this Story/);
  assert.doesNotMatch(sanitized, /image: https/);
});

test('summary source URL normalization rewrites CBC apex host', () => {
  assert.equal(
    normalizeSourceUrl('https://cbc.ca/news/canada/ottawa/teen-charged-with-murder-9.7192167'),
    'https://www.cbc.ca/news/canada/ottawa/teen-charged-with-murder-9.7192167'
  );

  assert.equal(
    normalizeSourceUrl('https://www.cbc.ca/news/canada/ottawa/teen-charged-with-murder-9.7192167'),
    'https://www.cbc.ca/news/canada/ottawa/teen-charged-with-murder-9.7192167'
  );
});

test('summary source candidates prefer CBC Lite story pages', () => {
  const url = 'https://www.cbc.ca/news/canada/ottawa/teen-charged-with-murder-of-woman-2-daughters-in-brockville-9.7192167';

  assert.equal(
    getCbcLiteUrl(url),
    'https://www.cbc.ca/lite/story/9.7192167'
  );

  assert.deepEqual(
    getSourceUrlCandidates(url),
    [
      'https://www.cbc.ca/lite/story/9.7192167',
      url
    ]
  );
});

test('record synthesis prompt distinguishes record name from location and dead suspects from arrests', () => {
  const prompt = __test.buildRecordSynthesisPrompt(
    {
      name: 'Hatfield',
      city: 'Montreal',
      province: 'QC',
      date: '2026-06-22',
      victims: 2,
      deaths: 3,
      injuries: 1,
      devices_used: null,
      warnings: null
    },
    {
      classification: 'reported',
      credible: 1,
      social: 0,
      other: 0
    },
    [
      {
        sourceType: 'other',
        url: 'https://people.com/example',
        summary: 'Police officer Mohamed Lamine Benredouane and civilian Michael Mizrahi were killed, and suspect Seth Hatfield was also killed.'
      }
    ],
    0
  );

  assert.match(prompt, /Record display name: Hatfield/);
  assert.match(prompt, /Incident location: Montreal, QC/);
  assert.match(prompt, /record display name is not part of the location/i);
  assert.match(prompt, /Do not say a suspect was apprehended/i);
  assert.match(prompt, /Keep victim, bystander, officer, civilian, community-member, and suspect roles separate/i);
  assert.match(prompt, /Never describe a person as the suspect, shooter, gunman, or attacker/i);
  assert.match(prompt, /Do not list a victim or bystander name as a suspect-identity conflict/i);
  assert.match(prompt, /victims are non-suspect fatalities/i);
  assert.match(prompt, /Do not call two victim deaths versus three total deaths a conflict/i);
});
