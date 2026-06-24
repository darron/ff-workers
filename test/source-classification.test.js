import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifySourceType,
  getRecordCredibility
} from '../src/source-classification.js';

test('classifies RCMP and CKOM incident sources as credible', () => {
  assert.equal(
    classifySourceType('https://rcmp.ca/en/saskatchewan/news/2026/06/4354309'),
    'official'
  );
  assert.equal(
    classifySourceType('https://www.ckom.com/2026/06/22/melville-man-charged-with-attempted-murder-after-two-rcmp-officers-shot/'),
    'news'
  );

  const credibility = getRecordCredibility([
    { url: 'https://rcmp.ca/en/saskatchewan/news/2026/06/4354309' },
    { url: 'https://www.ckom.com/2026/06/22/melville-man-charged-with-attempted-murder-after-two-rcmp-officers-shot/' },
    { url: 'https://x.com/CCFR_CCDAF/status/2069423697404768280' }
  ]);

  assert.equal(credibility.classification, 'corroborated');
  assert.equal(credibility.credible, 2);
  assert.equal(credibility.social, 1);
  assert.equal(credibility.socialOnly, false);
});
