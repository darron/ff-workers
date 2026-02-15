import { classifySourceType, getRecordCredibility } from './source-classification.js';

const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const MAX_STORY_TEXT_CHARS = 14000;
const MAX_STORY_SUMMARY_CHARS = 900;
const MAX_STORIES_FOR_SYNTHESIS = 30;
const MIN_EXTRACTED_TEXT_CHARS = 320;
const NO_TEXT_SUMMARY = 'No article text available for reliable summarization.';
const SOCIAL_ONLY_SUMMARY = 'Social-media source only. Treat this as alleged until corroborated by independent reporting.';

export function isAiSummaryEnabled(env) {
  return String(env?.AI_SUMMARY_ENABLED || 'false').toLowerCase() === 'true';
}

export function isAutoAiSummaryEnabled(env) {
  return String(env?.AI_SUMMARY_AUTO_ON_SAVE || 'false').toLowerCase() === 'true';
}

function isJinaFallbackEnabled(env) {
  return String(env?.AI_FETCH_JINA_FALLBACK || 'false').toLowerCase() === 'true';
}

function isMarkdownNewFallbackEnabled(env) {
  return String(env?.AI_FETCH_MARKDOWN_NEW_FALLBACK || 'false').toLowerCase() === 'true';
}

function getSummarizeDaemonUrl(env) {
  const raw = String(env?.AI_FETCH_SUMMARIZE_DAEMON_URL || '').trim();
  return raw.replace(/\/+$/, '');
}

function getSummarizeDaemonToken(env) {
  return String(env?.AI_FETCH_SUMMARIZE_DAEMON_TOKEN || '').trim();
}

function isSummarizeDaemonFallbackEnabled(env) {
  return !!getSummarizeDaemonUrl(env);
}

export async function enqueueRecordSummary(env, recordId, reason = 'record_updated') {
  if (!env?.SUMMARY_QUEUE || !recordId) {
    return { queued: false, reason: 'queue_not_configured' };
  }

  await env.SUMMARY_QUEUE.send({
    recordId,
    reason,
    requestedAt: new Date().toISOString()
  });

  return { queued: true };
}

export async function processSummaryQueue(batch, env) {
  for (const message of batch.messages) {
    try {
      const payload = message.body || {};
      const recordId = payload.recordId;
      if (!recordId) {
        message.ack();
        continue;
      }

      await summarizeRecord(recordId, env);
      message.ack();
    } catch (error) {
      console.error('Failed to process summary message:', error);
      message.retry();
    }
  }
}

async function summarizeRecord(recordId, env) {
  if (!env?.DB) {
    throw new Error('DB binding missing');
  }

  const record = await env.DB.prepare(
    `SELECT id, date, name, city, province, victims, deaths, injuries, devices_used, warnings
     FROM records
     WHERE id = ?`
  ).bind(recordId).first();

  if (!record) {
    return;
  }

  const storiesResult = await env.DB.prepare(
    `SELECT id, url, body_text, ai_summary
     FROM news_stories
     WHERE record_id = ?
     ORDER BY id`
  ).bind(recordId).all();

  const stories = storiesResult.results || [];

  for (const story of stories) {
    await refreshStorySummaryIfNeeded(env, story);
  }

  const refreshedResult = await env.DB.prepare(
    `SELECT id, url, body_text, ai_summary
     FROM news_stories
     WHERE record_id = ?
     ORDER BY id`
  ).bind(recordId).all();
  const refreshedStories = refreshedResult.results || [];

  const recordSummary = await buildRecordSummary(env, record, refreshedStories);

  await env.DB.prepare(
    `UPDATE records SET ai_summary = ? WHERE id = ?`
  ).bind(recordSummary, recordId).run();
}

async function refreshStorySummaryIfNeeded(env, story) {
  const existingSummary = (story.ai_summary || '').trim();
  const shouldAttemptSummary = !existingSummary || existingSummary === NO_TEXT_SUMMARY;
  if (!shouldAttemptSummary) {
    return;
  }

  const sourceType = classifySourceType(story.url || '');
  const extraction = await getStoryText(story, sourceType, env);
  const storyText = extraction.text;

  if (sourceType === 'social' && !storyText) {
    if (existingSummary !== SOCIAL_ONLY_SUMMARY) {
      await env.DB.prepare(
        `UPDATE news_stories SET ai_summary = ? WHERE id = ?`
      ).bind(SOCIAL_ONLY_SUMMARY, story.id).run();
    }
    return;
  }

  if (!storyText) {
    if (existingSummary !== NO_TEXT_SUMMARY) {
      await env.DB.prepare(
        `UPDATE news_stories SET ai_summary = ? WHERE id = ?`
      ).bind(NO_TEXT_SUMMARY, story.id).run();
    }
    return;
  }

  if (extraction.persistBodyText) {
    await env.DB.prepare(
      `UPDATE news_stories SET body_text = ? WHERE id = ?`
    ).bind(storyText.slice(0, MAX_STORY_TEXT_CHARS), story.id).run();
  }

  const summary = await summarizeStoryText(env, extraction.url || story.url, sourceType, storyText);
  if (!summary) {
    return;
  }

  if (summary !== existingSummary) {
    await env.DB.prepare(
      `UPDATE news_stories SET ai_summary = ? WHERE id = ?`
    ).bind(summary, story.id).run();
  }
}

async function summarizeStoryText(env, url, sourceType, storyText) {
  if (!isAiSummaryEnabled(env) || !env?.AI) {
    return heuristicSummary(storyText);
  }

  const prompt = [
    'Summarize this source in 3-5 factual sentences.',
    'Return only the summary text. Do not include introductory phrases.',
    'Do not speculate. If details are uncertain, say so explicitly.',
    `Source type: ${sourceType}`,
    `URL: ${url || 'N/A'}`,
    '',
    storyText
  ].join('\n');

  const aiText = await runAiText(env, prompt, 450);
  return aiText || heuristicSummary(storyText);
}

async function buildRecordSummary(env, record, stories) {
  const credibility = getRecordCredibility(stories);

  const sourceRows = stories.map(story => {
    const sourceType = classifySourceType(story.url || '');
    const summary = (story.ai_summary || '').trim().slice(0, MAX_STORY_SUMMARY_CHARS);
    return {
      id: story.id,
      url: story.url || '',
      sourceType,
      summary
    };
  });

  const orderedRows = sourceRows
    .sort((a, b) => scoreSourceType(b.sourceType) - scoreSourceType(a.sourceType))
    .slice(0, MAX_STORIES_FOR_SYNTHESIS);

  const omittedCount = sourceRows.length - orderedRows.length;

  if (!isAiSummaryEnabled(env) || !env?.AI) {
    return buildNonAiSynthesis(record, credibility, orderedRows, omittedCount);
  }

  const prompt = [
    'Create a cross-source synthesis for this incident.',
    'Output markdown with sections exactly:',
    '1) Classification',
    '2) Incident Summary',
    '3) Well-Supported Details',
    '4) Unverified or Conflicting Claims',
    '5) Source Quality Notes',
    '',
    'Classification rules:',
    '- alleged: only social-media claims and no independent credible sources',
    '- reported: at least one credible source',
    '- corroborated: two or more independent credible sources align on core facts',
    '',
    `Record: ${record.name || ''} in ${record.city || ''}, ${record.province || ''} (${record.date || ''})`,
    `Victims/deaths/injuries: ${record.victims ?? ''}/${record.deaths ?? ''}/${record.injuries ?? ''}`,
    `Devices used: ${record.devices_used || 'N/A'}`,
    `Warnings: ${record.warnings || 'N/A'}`,
    `Credibility counts: credible=${credibility.credible}, social=${credibility.social}, other=${credibility.other}`,
    omittedCount > 0 ? `Only first ${orderedRows.length} sources provided; ${omittedCount} omitted for context limits.` : 'All sources included.',
    '',
    'Sources:',
    ...orderedRows.map((row, index) => `${index + 1}. [${row.sourceType}] ${row.url}\nSummary: ${row.summary || 'No summary available.'}`)
  ].join('\n');

  const aiText = await runAiText(env, prompt, 900);
  if (aiText) {
    return aiText;
  }

  return buildNonAiSynthesis(record, credibility, orderedRows, omittedCount);
}

function buildNonAiSynthesis(record, credibility, rows, omittedCount) {
  const classification = credibility.classification;
  const topFacts = rows
    .filter(row => row.summary)
    .slice(0, 5)
    .map((row, index) => `${index + 1}. ${row.summary}`)
    .join('\n');

  return [
    '## Classification',
    classification,
    '',
    '## Incident Summary',
    `Automated fallback summary for ${record.name || 'incident'} in ${record.city || 'unknown location'} (${record.date || 'unknown date'}).`,
    '',
    '## Well-Supported Details',
    topFacts || 'No high-quality source summaries are available yet.',
    '',
    '## Unverified or Conflicting Claims',
    credibility.socialOnly ? 'Claims currently rely on social sources and should be treated as alleged until corroborated.' : 'No specific conflicts extracted in fallback mode.',
    '',
    '## Source Quality Notes',
    `Credible: ${credibility.credible}, Social: ${credibility.social}, Other: ${credibility.other}`,
    omittedCount > 0 ? `Additional sources omitted from synthesis due to context limits: ${omittedCount}.` : 'All available sources were included.'
  ].join('\n');
}

function scoreSourceType(sourceType) {
  switch (sourceType) {
    case 'official':
      return 3;
    case 'news':
      return 2;
    case 'other':
      return 1;
    case 'social':
      return 0;
    default:
      return 0;
  }
}

async function runAiText(env, prompt, maxTokens = 500) {
  try {
    const model = env.AI_MODEL || DEFAULT_MODEL;
    const result = await env.AI.run(model, {
      messages: [
        {
          role: 'system',
          content: 'You are a careful incident-analysis assistant. Be factual, cautious, and explicit about uncertainty.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: maxTokens,
      temperature: 0.2
    });

    return extractAiText(result);
  } catch (error) {
    console.error('AI call failed:', error);
    return null;
  }
}

function extractAiText(result) {
  if (!result) return null;
  if (typeof result === 'string') return result.trim();
  if (typeof result.response === 'string') return result.response.trim();

  if (Array.isArray(result.result) && result.result.length > 0) {
    const first = result.result[0];
    if (typeof first === 'string') return first.trim();
    if (typeof first?.response === 'string') return first.response.trim();
  }

  if (typeof result.output_text === 'string') return result.output_text.trim();
  if (Array.isArray(result.output) && result.output.length > 0) {
    const text = result.output
      .map(item => {
        if (typeof item === 'string') return item;
        if (typeof item?.text === 'string') return item.text;
        if (typeof item?.content === 'string') return item.content;
        return '';
      })
      .join('\n')
      .trim();
    if (text) return text;
  }

  return null;
}

function normalizeSourceUrl(rawUrl) {
  if (!rawUrl) {
    return '';
  }

  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();

    // RCMP links often canonicalize to rcmp.ca and become easier to extract.
    if (host === 'rcmp-grc.gc.ca' || host === 'www.rcmp-grc.gc.ca') {
      parsed.hostname = 'www.rcmp.ca';
    }

    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

async function getStoryText(story, sourceType, env) {
  const existingBodyText = normalizeText(story.body_text || '');
  if (existingBodyText.length >= 500) {
    return {
      text: existingBodyText.slice(0, MAX_STORY_TEXT_CHARS),
      method: 'stored_body_text',
      url: story.url || '',
      persistBodyText: false
    };
  }

  const normalizedUrl = normalizeSourceUrl(story.url || '');
  const urlCandidates = Array.from(new Set([normalizedUrl, story.url || ''].filter(Boolean)));

  let best = {
    text: existingBodyText.slice(0, MAX_STORY_TEXT_CHARS),
    method: existingBodyText ? 'stored_body_text_partial' : 'none',
    url: story.url || '',
    score: scoreExtraction(existingBodyText, existingBodyText ? 'stored_body_text_partial' : 'none')
  };

  for (const candidate of urlCandidates) {
    const extracted = await fetchAndExtractFromUrl(candidate);
    if (isBetterExtraction(extracted, best)) {
      best = extracted;
    }

    if (best.score >= 5) {
      break;
    }
  }

  const shouldTryFallback = sourceType !== 'social' && !isProxyUrl(normalizedUrl);
  if (shouldTryFallback && best.score < 4 && normalizedUrl) {
    if (isSummarizeDaemonFallbackEnabled(env)) {
      const extracted = await fetchViaSummarizeDaemon(normalizedUrl, env);
      if (isBetterExtraction(extracted, best)) {
        best = extracted;
      }
    }

    if (isJinaFallbackEnabled(env)) {
      const extracted = await fetchViaJinaReader(normalizedUrl);
      if (isBetterExtraction(extracted, best)) {
        best = extracted;
      }
    }

    if (isMarkdownNewFallbackEnabled(env) && best.score < 4) {
      const extracted = await fetchViaMarkdownNew(normalizedUrl);
      if (isBetterExtraction(extracted, best)) {
        best = extracted;
      }
    }
  }

  return {
    text: (best.text || '').slice(0, MAX_STORY_TEXT_CHARS),
    method: best.method,
    url: best.url || normalizedUrl || story.url || '',
    persistBodyText: best.method !== 'stored_body_text' && best.method !== 'stored_body_text_partial' && (best.text || '').length >= MIN_EXTRACTED_TEXT_CHARS
  };
}

function isProxyUrl(urlString) {
  try {
    const host = new URL(urlString).hostname.toLowerCase();
    return host === 'r.jina.ai' || host === 'markdown.new';
  } catch {
    return false;
  }
}

async function fetchAndExtractFromUrl(url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'MassMurderCanadaBot/1.0 (+https://massmurdercanada.org)',
        'Accept': 'text/markdown, text/html;q=0.9, application/xhtml+xml;q=0.9, text/plain;q=0.8, */*;q=0.7'
      }
    });

    if (!response.ok) {
      return null;
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const text = await response.text();

    if (contentType.includes('text/markdown') || contentType.includes('text/plain')) {
      const markdownText = normalizeText(cleanMarkdownServiceOutput(text));
      return makeExtractionResult(markdownText, 'accept_markdown', url);
    }

    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      return makeExtractionResult(normalizeText(text), 'non_html_text', url);
    }

    const structured = extractStructuredTextFromHtml(text);
    const generic = extractTextFromHtml(text);

    return isBetterExtraction(structured, generic) ? structured : generic;
  } catch (error) {
    console.error(`Failed to fetch story URL ${url}:`, error);
    return null;
  }
}

async function fetchViaJinaReader(url) {
  try {
    const proxyUrl = `https://r.jina.ai/${url}`;
    const response = await fetch(proxyUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'MassMurderCanadaBot/1.0 (+https://massmurdercanada.org)'
      }
    });

    if (!response.ok) {
      return null;
    }

    const text = await response.text();
    return makeExtractionResult(normalizeText(cleanMarkdownServiceOutput(text)), 'jina_reader', url);
  } catch (error) {
    console.error(`Failed jina reader fallback for ${url}:`, error);
    return null;
  }
}

async function fetchViaMarkdownNew(url) {
  try {
    const response = await fetch('https://markdown.new/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MassMurderCanadaBot/1.0 (+https://massmurdercanada.org)'
      },
      body: JSON.stringify({
        url,
        method: 'auto',
        retain_images: false
      })
    });

    if (!response.ok) {
      return null;
    }

    const text = await response.text();
    return makeExtractionResult(normalizeText(cleanMarkdownServiceOutput(text)), 'markdown_new', url);
  } catch (error) {
    console.error(`Failed markdown.new fallback for ${url}:`, error);
    return null;
  }
}

async function fetchViaSummarizeDaemon(url, env) {
  const daemonBase = getSummarizeDaemonUrl(env);
  if (!daemonBase) {
    return null;
  }

  const token = getSummarizeDaemonToken(env);
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'MassMurderCanadaBot/1.0 (+https://massmurdercanada.org)'
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const startResponse = await fetch(`${daemonBase}/v1/summarize`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url,
        title: null,
        mode: 'url',
        extractOnly: true,
        format: 'markdown',
        markdownMode: 'readability',
        preprocess: 'auto',
        maxCharacters: MAX_STORY_TEXT_CHARS
      })
    });

    if (!startResponse.ok) {
      return null;
    }

    const startJson = await startResponse.json().catch(() => null);
    if (!startJson) {
      return null;
    }

    // Some daemon variants may return extracted text directly.
    const directText = normalizeText(
      startJson.text || startJson.content || startJson.summary || startJson.markdown || ''
    );
    if (directText) {
      return makeExtractionResult(directText, 'summarize_daemon_direct', url);
    }

    if (!startJson.id) {
      return null;
    }

    const eventsText = await fetchSummarizeEventsText(daemonBase, startJson.id, headers);
    if (!eventsText) {
      return null;
    }

    return makeExtractionResult(normalizeText(eventsText), 'summarize_daemon_sse', url);
  } catch (error) {
    console.error(`Failed summarize daemon fallback for ${url}:`, error);
    return null;
  }
}

async function fetchSummarizeEventsText(daemonBase, runId, headers) {
  try {
    const response = await fetch(`${daemonBase}/v1/summarize/${encodeURIComponent(runId)}/events`, {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      return '';
    }

    const raw = await response.text();
    return parseSseText(raw);
  } catch (error) {
    console.error(`Failed summarize daemon events fetch for ${runId}:`, error);
    return '';
  }
}

function parseSseText(rawSse) {
  if (!rawSse) return '';

  const lines = String(rawSse).replace(/\r\n?/g, '\n').split('\n');
  const chunks = [];
  let currentEvent = 'message';
  const currentDataLines = [];

  const flush = () => {
    if (currentDataLines.length === 0) {
      currentEvent = 'message';
      return;
    }

    const dataText = currentDataLines.join('\n');
    if (currentEvent === 'chunk' || currentEvent === 'message') {
      const parsed = safeJsonParse(dataText);
      if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
        chunks.push(parsed.text);
      } else {
        chunks.push(dataText);
      }
    }

    currentDataLines.length = 0;
    currentEvent = 'message';
  };

  for (const line of lines) {
    if (!line.trim()) {
      flush();
      continue;
    }

    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim() || 'message';
      continue;
    }

    if (line.startsWith('data:')) {
      currentDataLines.push(line.slice(5).trim());
      continue;
    }
  }

  flush();
  return chunks.join('');
}

function makeExtractionResult(text, method, url) {
  const normalized = normalizeText(text || '');
  return {
    text: normalized,
    method,
    url,
    score: scoreExtraction(normalized, method)
  };
}

function isBetterExtraction(candidate, currentBest) {
  if (!candidate) return false;
  if (!currentBest) return true;
  return candidate.score > currentBest.score;
}

function scoreExtraction(text, method) {
  const normalized = normalizeText(text || '');
  if (!normalized) {
    return 0;
  }

  let score = 1;

  if (normalized.length >= MIN_EXTRACTED_TEXT_CHARS) {
    score += 2;
  }
  if (normalized.length >= 1200) {
    score += 1;
  }

  if (method === 'jsonld_article_body' || method === 'article_tag') {
    score += 2;
  }
  if (method === 'jina_reader' || method === 'markdown_new' || method === 'accept_markdown') {
    score += 1;
  }

  if (looksLikeBoilerplate(normalized)) {
    score -= 2;
  }

  return Math.max(0, score);
}

function looksLikeBoilerplate(text) {
  const lower = text.toLowerCase();
  const boilerplateSignals = [
    'cookie',
    'privacy policy',
    'terms of use',
    'all rights reserved',
    'subscribe',
    'sign in',
    'menu'
  ];

  const hits = boilerplateSignals.reduce((count, signal) => count + (lower.includes(signal) ? 1 : 0), 0);
  return hits >= 4 && text.length < 1800;
}

function extractStructuredTextFromHtml(html) {
  const jsonLd = extractJsonLdArticleText(html);
  const articleTag = extractBlockText(html, 'article');
  const mainTag = extractBlockText(html, 'main');
  const meta = extractMetaText(html);

  const candidates = [
    makeExtractionResult(jsonLd.articleBody || '', 'jsonld_article_body', ''),
    makeExtractionResult(jsonLd.combined || '', 'jsonld_combined', ''),
    makeExtractionResult(articleTag, 'article_tag', ''),
    makeExtractionResult(mainTag, 'main_tag', ''),
    makeExtractionResult(meta, 'meta_text', '')
  ];

  let best = null;
  for (const candidate of candidates) {
    if (isBetterExtraction(candidate, best)) {
      best = candidate;
    }
  }

  return best || makeExtractionResult('', 'none', '');
}

function extractJsonLdArticleText(html) {
  const scriptRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const nodes = [];
  let match;

  while ((match = scriptRegex.exec(html)) !== null) {
    const raw = (match[1] || '').trim();
    if (!raw) continue;
    const parsed = safeJsonParse(raw);
    if (!parsed) continue;
    collectJsonLdNodes(parsed, nodes);
  }

  let bestArticleBody = '';
  let bestCombined = '';

  for (const node of nodes) {
    const type = normalizeType(node?.['@type']);
    const isArticleLike = type.includes('article') || type.includes('newsarticle') || type.includes('report');
    const articleBody = normalizeText(node?.articleBody || '');
    const description = normalizeText(node?.description || '');
    const headline = normalizeText(node?.headline || node?.name || '');

    if (isArticleLike && articleBody.length > bestArticleBody.length) {
      bestArticleBody = articleBody;
    }

    const combined = normalizeText([headline, description, articleBody].filter(Boolean).join('\n\n'));
    if (combined.length > bestCombined.length) {
      bestCombined = combined;
    }
  }

  return {
    articleBody: bestArticleBody,
    combined: bestCombined
  };
}

function collectJsonLdNodes(input, out) {
  if (!input) return;

  if (Array.isArray(input)) {
    for (const item of input) {
      collectJsonLdNodes(item, out);
    }
    return;
  }

  if (typeof input !== 'object') {
    return;
  }

  out.push(input);

  if (Array.isArray(input['@graph'])) {
    for (const graphNode of input['@graph']) {
      collectJsonLdNodes(graphNode, out);
    }
  }
}

function normalizeType(value) {
  if (Array.isArray(value)) {
    return value.map(v => String(v || '').toLowerCase()).join(' ');
  }
  return String(value || '').toLowerCase();
}

function safeJsonParse(raw) {
  const cleaned = raw
    .replace(/^\s*<!--/, '')
    .replace(/-->\s*$/, '')
    .replace(/^\s*\/\/<!\[CDATA\[/, '')
    .replace(/\/\/\]\]>\s*$/, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function extractMetaText(html) {
  const desiredKeys = new Set([
    'description',
    'og:description',
    'twitter:description',
    'og:title',
    'twitter:title'
  ]);

  const values = [];
  const metaRegex = /<meta\b[^>]*>/gi;
  let match;

  while ((match = metaRegex.exec(html)) !== null) {
    const attrs = parseHtmlAttributes(match[0]);
    const key = String(attrs.name || attrs.property || '').toLowerCase();
    const content = normalizeText(attrs.content || '');

    if (desiredKeys.has(key) && content) {
      values.push(content);
    }
  }

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) {
    values.unshift(normalizeText(stripHtmlTags(titleMatch[1])));
  }

  return normalizeText(values.join('\n\n'));
}

function parseHtmlAttributes(tag) {
  const attrs = {};
  const attrRegex = /([a-zA-Z_:][a-zA-Z0-9_:.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match;

  while ((match = attrRegex.exec(tag)) !== null) {
    const key = match[1]?.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (key) {
      attrs[key] = value;
    }
  }

  return attrs;
}

function extractBlockText(html, tagName) {
  const regex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  let best = '';
  let match;

  while ((match = regex.exec(html)) !== null) {
    const text = normalizeText(stripHtmlTags(match[1] || ''));
    if (text.length > best.length) {
      best = text;
    }
  }

  return best;
}

function extractTextFromHtml(html) {
  if (!html) return makeExtractionResult('', 'none', '');

  const withoutScripts = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ');

  const text = normalizeText(stripHtmlTags(withoutScripts));
  return makeExtractionResult(text, 'generic_html_strip', '');
}

function cleanMarkdownServiceOutput(text) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const filtered = [];
  let seenMarkdownBody = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!seenMarkdownBody) {
      if (
        line.toLowerCase().startsWith('title:') ||
        line.toLowerCase().startsWith('url source:') ||
        line.toLowerCase().startsWith('markdown content:') ||
        line.toLowerCase().startsWith('published time:') ||
        line.toLowerCase().startsWith('warning:')
      ) {
        continue;
      }

      if (line.startsWith('#') || line.startsWith('>') || line.startsWith('- ') || line.startsWith('* ')) {
        seenMarkdownBody = true;
      }
    }

    filtered.push(rawLine);
  }

  return filtered.join('\n');
}

function stripHtmlTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function heuristicSummary(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return '';
  }

  if (normalized.length <= 550) {
    return normalized;
  }

  return `${normalized.slice(0, 550)}...`;
}
