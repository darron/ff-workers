/**
 * URL source classification helpers shared by rendering and AI synthesis.
 */

const SOCIAL_DOMAINS = [
  'twitter.com',
  'x.com',
  't.co',
  'facebook.com',
  'fb.com',
  'instagram.com',
  'youtube.com',
  'youtu.be',
  'reddit.com',
  'threads.net',
  'tiktok.com'
];

const OFFICIAL_DOMAINS = [
  'canada.ca',
  'gc.ca',
  'rcmp-grc.gc.ca',
  'justice.gc.ca',
  'ontario.ca',
  'quebec.ca',
  'alberta.ca',
  'bc.gov',
  'gov.bc.ca',
  'saskatchewan.ca',
  'manitoba.ca',
  'novascotia.ca',
  'newbrunswick.ca',
  'nl.ca',
  'pei.ca',
  'nunavut.ca',
  'yukon.ca',
  'nwt.ca',
  'statcan.gc.ca',
  'publicsafety.gc.ca',
  'parl.ca',
  'supremecourt.ca'
];

const NEWS_HINTS = [
  'news',
  'cbc.ca',
  'ctvnews.ca',
  'globalnews.ca',
  'thestar.com',
  'theglobeandmail.com',
  'nationalpost.com',
  'vancouverisawesome.com',
  'montrealgazette.com',
  'torontosun.com',
  'citynews.ca',
  'apnews.com',
  'reuters.com',
  'bbc.com',
  'nytimes.com',
  'washingtonpost.com',
  'vancouversun.com',
  'calgaryherald.com',
  'edmontonjournal.com',
  'channel2now.com',
  'www.theepochtimes.com'
];

function parseHostname(rawUrl) {
  if (!rawUrl) return '';
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
  } catch {
    return '';
  }
}

function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function classifySourceType(rawUrl) {
  const hostname = parseHostname(rawUrl);
  if (!hostname) return 'other';

  if (SOCIAL_DOMAINS.some(domain => matchesDomain(hostname, domain))) {
    return 'social';
  }

  if (OFFICIAL_DOMAINS.some(domain => matchesDomain(hostname, domain))) {
    return 'official';
  }

  if (NEWS_HINTS.some(hint => hostname.includes(hint))) {
    return 'news';
  }

  return 'other';
}

export function isCredibleSourceType(sourceType) {
  return sourceType === 'news' || sourceType === 'official';
}

export function getSourceTypeLabel(sourceType) {
  switch (sourceType) {
    case 'news':
      return 'News';
    case 'official':
      return 'Official';
    case 'social':
      return 'Social';
    default:
      return 'Other';
  }
}

export function getRecordCredibility(stories = []) {
  let credible = 0;
  let social = 0;
  let other = 0;

  for (const story of stories) {
    const sourceType = classifySourceType(story?.url || '');
    if (isCredibleSourceType(sourceType)) {
      credible += 1;
    } else if (sourceType === 'social') {
      social += 1;
    } else {
      other += 1;
    }
  }

  const total = stories.length;
  const classification = credible > 1 ? 'corroborated' : credible === 1 ? 'reported' : social > 0 ? 'alleged' : 'unverified';

  return {
    classification,
    credible,
    social,
    other,
    total,
    socialOnly: total > 0 && credible === 0 && social > 0
  };
}
