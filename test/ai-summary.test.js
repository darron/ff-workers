import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeExtractedText } from '../src/ai-summary.js';

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
