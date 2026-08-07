import { buildProvinceMapData } from './templates.js';
import {
  classifySourceType,
  getRecordCredibility,
  getSourceTypeLabel
} from './source-classification.js';

const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8';
const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';
const AGENT_SKILLS_INDEX_PATH = '/.well-known/agent-skills/index.json';
const MARKDOWN_NOTE = '> NOTE: Mass killings are defined as 4+ victim deaths.';
const CONTACT_LINK = '[darron@massmurdercanada.org](mailto:darron@massmurdercanada.org)';

const GROUP_LABELS = {
  mass: 'Mass Killings',
  massother: 'Non Firearms Mass Killings',
  massfirearms: 'Firearms Mass Killings',
  massfirearmslicensed: 'Licensed Firearms Mass Killings',
  oic: 'OIC Firearms',
  suicide: 'Suicide'
};

const NAVIGATION = [
  ['Home', '/'],
  ['Map', '/map/canada'],
  ['Mass Killings', '/records/group/mass'],
  ['Non Firearms Mass Killings', '/records/group/massother'],
  ['Firearms Mass Killings', '/records/group/massfirearms'],
  ['Licensed Firearms Mass Killings', '/records/group/massfirearmslicensed'],
  ['OIC Firearms', '/records/group/oic'],
  ['Suicide', '/records/group/suicide']
];

const RECORD_TABLE_HEADER = '| Date | Name | City | Province | Licensed | Victims | Deaths | Injuries | Suicide | Firearms | OIC Impact |';
const RECORD_TABLE_DIVIDER = '| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |';

/**
 * Return true when the client explicitly accepts a non-zero quality of Markdown.
 */
export function acceptsMarkdown(request) {
  const accept = request?.headers?.get('Accept') || '';
  return accept.split(',').some((entry) => {
    const [mediaType, ...parameters] = entry.trim().toLowerCase().split(';');
    if (mediaType.trim() !== 'text/markdown') {
      return false;
    }

    const qualityParameter = parameters.find((parameter) => /^\s*q\s*=/.test(parameter));
    if (!qualityParameter) {
      return true;
    }

    const quality = Number(qualityParameter.split('=')[1]);
    return Number.isFinite(quality) ? quality > 0 : true;
  });
}

/**
 * Render exactly one public representation and keep caches separate by Accept.
 */
export function renderNegotiatedPage(request, renderHtml, renderMarkdown, options = {}) {
  const linkHeader = buildPageLinkHeader(request);

  if (options.forceMarkdown || acceptsMarkdown(request)) {
    const body = String(renderMarkdown() || '');
    const headers = {
      'Content-Type': MARKDOWN_CONTENT_TYPE,
      'Vary': 'Accept',
      'Link': linkHeader,
      'x-markdown-tokens': String(estimateMarkdownTokens(body))
    };
    return new Response(body, { headers });
  }

  return new Response(String(renderHtml() || ''), {
    headers: {
      'Content-Type': HTML_CONTENT_TYPE,
      'Vary': 'Accept',
      'Link': linkHeader
    }
  });
}

function buildPageLinkHeader(request) {
  const requestUrl = new URL(request.url);
  const markdownUrl = new URL(requestUrl);
  markdownUrl.pathname = markdownPathname(requestUrl.pathname);

  return [
    `<${new URL(AGENT_SKILLS_INDEX_PATH, requestUrl).href}>; rel="describedby"`,
    `<${markdownUrl.href}>; rel="alternate"; type="text/markdown"`
  ].join(', ');
}

function markdownPathname(pathname) {
  if (pathname === '/index.md' || pathname.endsWith('.md')) {
    return pathname;
  }

  return pathname === '/' ? '/index.md' : `${pathname}.md`;
}

export function renderHomePageMarkdown(records = [], currentPath = '/') {
  const rows = records.map((record) => renderRecordRow(record));

  return [
    `# ${pageTitle(currentPath)}`,
    '',
    MARKDOWN_NOTE,
    '',
    renderNavigation(),
    '',
    `## Events: ${records.length}`,
    '',
    RECORD_TABLE_HEADER,
    RECORD_TABLE_DIVIDER,
    ...rows,
    '',
    renderFooter()
  ].join('\n');
}

export function renderCanadaMapPageMarkdown(records = []) {
  const provinceMap = buildProvinceMapData(records);
  const provinces = Object.values(provinceMap.byCode).sort((a, b) => a.name.localeCompare(b.name));
  const summaryRows = provinces.map((province) => [
    markdownLink(province.code, provincePath(province.code)),
    province.events,
    formatEventsPerMillion(province.eventsPerMillion),
    province.deaths,
    province.victims,
    `${province.mappedEvents}/${province.events}`,
    markdownLink(`Open ${province.code}`, provincePath(province.code))
  ]);

  const provinceSections = provinces.map((province) => renderProvinceSection(province));
  const unmappedNote = provinceMap.unmappedCount > 0
    ? `${provinceMap.unmappedCount} event(s) are outside mapped provinces (for example USA).`
    : '';

  return [
    '# Mass Murder Canada — Province Map',
    '',
    MARKDOWN_NOTE,
    '',
    renderNavigation(),
    '',
    '## Province summary',
    '',
    '| Province | Events | Events / 1M | Deaths | Victims | Mapped | Page |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...summaryRows.map((row) => `| ${row.join(' | ')} |`),
    ...(unmappedNote ? ['', `> ${escapeMarkdownText(unmappedNote)}`] : []),
    '',
    ...provinceSections,
    renderFooter()
  ].join('\n');
}

export function renderRecordPageMarkdown(record, currentPath = '/') {
  if (!record) {
    return '# Record not found';
  }

  const newsStories = record.newsStories || [];
  const credibility = getRecordCredibility(newsStories);
  const sections = [
    '# [Mass Murder 🇨🇦](/)',
    '',
    MARKDOWN_NOTE,
    '',
    renderNavigation(),
    '',
    `## ${escapeMarkdownText(record.name || '')} in ${escapeMarkdownText(record.city || '')} in ${formatDateYear(record.date)}`,
    '',
    RECORD_TABLE_HEADER,
    RECORD_TABLE_DIVIDER,
    renderRecordRow(record, false)
  ];

  if (record.devices_used) {
    sections.push('', '### Used', '', escapeMarkdownText(record.devices_used));
  }

  if (record.warnings) {
    sections.push('', '### Warnings', '', escapeMarkdownText(record.warnings));
  }

  if (record.ai_summary) {
    sections.push('', '### AI Synthesis', '', String(record.ai_summary).trim());
  }

  if (newsStories.length > 0) {
    sections.push(
      '',
      `> ${formatCredibilitySummary(credibility)}`,
      '',
      '### News Stories',
      ''
    );

    for (const story of newsStories) {
      const url = String(story?.url || '').trim();
      const sourceType = getSourceTypeLabel(classifySourceType(url));
      sections.push(`- ${url ? markdownLink(sourceType, url) : escapeMarkdownText(sourceType)}`);

      if (story?.ai_summary) {
        const summary = String(story.ai_summary)
          .trim()
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n');
        sections.push(summary);
      }

      sections.push('');
    }
  }

  sections.push('', renderFooter());
  return sections.join('\n');
}

function renderRecordRow(record, linkName = true) {
  const province = String(record.province || '');
  const name = linkName && record.id
    ? markdownLink(record.name || '', `/records/${encodeURIComponent(String(record.id))}`)
    : escapeMarkdownText(record.name || '');

  return `| ${[
    escapeMarkdownText(formatDateYear(record.date)),
    name,
    escapeMarkdownText(record.city || ''),
    province ? markdownLink(province, provincePath(province)) : '',
    formatNullableBool(record.licensed),
    Number(record.victims) || 0,
    Number(record.deaths) || 0,
    Number(record.injuries) || 0,
    formatNullableBool(record.suicide),
    formatNullableBool(record.firearms),
    formatNullableBool(record.oic_impact)
  ].map((cell) => escapeTableCell(cell)).join(' | ')} |`;
}

function renderProvinceSection(province) {
  const recentEvents = province.records.length > 0
    ? province.records.map((record) => {
      const event = record.id
        ? markdownLink(record.name, `/records/${encodeURIComponent(record.id)}`)
        : escapeMarkdownText(record.name);
      return `- ${escapeMarkdownText(record.year)} — ${event} — ${escapeMarkdownText(record.city)}; deaths ${record.deaths}; victims ${record.victims}`;
    })
    : ['- No events in the current data.'];

  return [
    `### ${escapeMarkdownText(province.name)} (${escapeMarkdownText(province.code)})`,
    '',
    `- Events: ${province.events}`,
    `- Events / 1M: ${formatEventsPerMillion(province.eventsPerMillion)}`,
    `- Deaths: ${province.deaths}`,
    `- Victims: ${province.victims}`,
    `- Mapped coordinates: ${province.mappedEvents}/${province.events}`,
    '',
    '#### Recent events',
    '',
    ...recentEvents,
    '',
    `- ${markdownLink(`Open all events for ${province.code}`, provincePath(province.code))}`,
    ''
  ].join('\n');
}

function renderNavigation() {
  return [
    '## Navigation',
    '',
    ...NAVIGATION.map(([label, href]) => `- ${markdownLink(label, href)}`)
  ].join('\n');
}

function renderFooter() {
  return [
    '---',
    '',
    `Something missing or wrong? Please send an email to ${CONTACT_LINK}.`,
    '',
    `Copyright © ${new Date().getFullYear()} Mass Murder Canada`
  ].join('\n');
}

function formatCredibilitySummary(credibility) {
  if (credibility.socialOnly) {
    return 'Status: Alleged (social-source-only). No independent news/official sources linked yet.';
  }

  if (credibility.classification === 'corroborated') {
    return `Status: Corroborated across multiple credible sources. Credible: ${credibility.credible}, Social: ${credibility.social}, Other: ${credibility.other}.`;
  }

  if (credibility.classification === 'reported') {
    return `Status: Reported by at least one credible source. Credible: ${credibility.credible}, Social: ${credibility.social}, Other: ${credibility.other}.`;
  }

  return `Status: Unverified. Credible: ${credibility.credible}, Social: ${credibility.social}, Other: ${credibility.other}.`;
}

function pageTitle(currentPath) {
  const normalizedPath = String(currentPath || '/').replace(/\/$/, '') || '/';
  const groupPrefix = '/records/group/';
  if (normalizedPath.startsWith(groupPrefix)) {
    const group = normalizedPath.slice(groupPrefix.length);
    return `Mass Murder Canada — ${GROUP_LABELS[group] || 'Records'}`;
  }

  const provincePrefix = '/records/provinces/';
  if (normalizedPath.startsWith(provincePrefix)) {
    return `Mass Murder Canada — Province ${normalizedPath.slice(provincePrefix.length).toUpperCase()}`;
  }

  return 'Mass Murder 🇨🇦';
}

function provincePath(province) {
  return `/records/provinces/${encodeURIComponent(String(province || '').toLowerCase())}`;
}

function markdownLink(label, href) {
  const safeLabel = escapeMarkdownText(label);
  return href ? `[${safeLabel}](${escapeMarkdownUrl(href)})` : safeLabel;
}

function escapeMarkdownText(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/[\\`*_{}[\]()#+.!|<>]/g, '\\$&');
}

function escapeTableCell(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

function escapeMarkdownUrl(value) {
  return String(value ?? '').replace(/[\\()]/g, '\\$&');
}

function formatDateYear(dateString) {
  if (!dateString) return '';
  const rawDate = String(dateString);
  const date = new Date(rawDate);
  if (Number.isFinite(date.getTime())) {
    return date.getFullYear().toString();
  }

  const yearMatch = rawDate.match(/\b(19|20)\d{2}\b/);
  return yearMatch ? yearMatch[0] : rawDate;
}

function formatNullableBool(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return value === 1 ? 'Yes' : 'No';
}

function formatEventsPerMillion(value) {
  const numeric = Number(value) || 0;
  if (numeric >= 10) return numeric.toFixed(2);
  if (numeric >= 1) return numeric.toFixed(3);
  return numeric.toFixed(4);
}

function estimateMarkdownTokens(markdown) {
  const byteLength = new TextEncoder().encode(markdown).length;
  return byteLength === 0 ? 0 : Math.ceil(byteLength / 4);
}
