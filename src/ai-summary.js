import { classifySourceType, getRecordCredibility } from './source-classification.js';
import { safeFetchPublicText, validateAndNormalizePublicHttpUrl } from './url-safety.js';

const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const MAX_STORY_TEXT_CHARS = 14000;
const MAX_SOURCE_FETCH_BYTES = 2 * 1024 * 1024;
const MAX_STORY_SUMMARY_CHARS = 900;
const MAX_STORIES_FOR_SYNTHESIS = 30;
const MIN_EXTRACTED_TEXT_CHARS = 320;
const DEFAULT_STORIES_PER_JOB = 10;
const MAX_STORIES_PER_JOB = 25;
const NO_TEXT_SUMMARY = 'No article text available for reliable summarization.';
const SOCIAL_ONLY_SUMMARY = 'Social-media source only. Treat this as alleged until corroborated by independent reporting.';
const UNSAFE_URL_SUMMARY = 'Source URL blocked by safety policy (must be public http/https).';

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

function getStoriesPerJob(env, payload = {}) {
  const payloadValue = Number.parseInt(String(payload?.storiesPerJob ?? ''), 10);
  if (Number.isInteger(payloadValue) && payloadValue > 0) {
    return Math.min(payloadValue, MAX_STORIES_PER_JOB);
  }

  const envValue = Number.parseInt(String(env?.AI_SUMMARY_STORIES_PER_JOB || ''), 10);
  if (Number.isInteger(envValue) && envValue > 0) {
    return Math.min(envValue, MAX_STORIES_PER_JOB);
  }

  return DEFAULT_STORIES_PER_JOB;
}

function parseOffset(rawOffset) {
  const value = Number.parseInt(String(rawOffset ?? '0'), 10);
  if (!Number.isInteger(value) || value < 0) {
    return 0;
  }
  return value;
}

function extractYearOnly(rawDate) {
  const text = String(rawDate ?? '').trim();
  if (!text) {
    return '';
  }

  const match = text.match(/\b(1[5-9]\d{2}|20\d{2}|2100)\b/);
  return match ? match[1] : '';
}

function logSummaryEvent(event, details = {}) {
  try {
    console.log(JSON.stringify({
      event,
      at: new Date().toISOString(),
      ...details
    }));
  } catch (error) {
    console.log(`{"event":"${event}","at":"${new Date().toISOString()}","log_error":"failed_to_serialize"}`);
  }
}

function serializeError(error) {
  if (!error) return null;
  return {
    message: error.message || String(error),
    name: error.name || 'Error'
  };
}

function incrementCounter(counter, key) {
  if (!key) return;
  counter[key] = (counter[key] || 0) + 1;
}

function createChunkMetrics(recordId, offset, storiesPerJob, totalStories, chunkSize) {
  return {
    recordId,
    offset,
    storiesPerJob,
    totalStories,
    chunkSize,
    processedStories: 0,
    storyActions: {},
    extractionMethods: {},
    persistedBodyTextCount: 0,
    synthesisMode: null,
    synthesisSourceCount: 0,
    synthesisOmittedCount: 0
  };
}

function createRuntimeState() {
  return {
    subrequestLimited: false
  };
}

function isTooManySubrequestsError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('too many subrequests');
}

function markSubrequestLimited(runtimeState, error, phase, url = '') {
  if (!runtimeState || runtimeState.subrequestLimited || !isTooManySubrequestsError(error)) {
    return;
  }

  runtimeState.subrequestLimited = true;
  logSummaryEvent('ai_summary_subrequest_limit', {
    status: 'detected',
    phase,
    url
  });
}

function recordStoryOutcome(metrics, outcome) {
  if (!metrics || !outcome) return;
  metrics.processedStories += 1;
  incrementCounter(metrics.storyActions, outcome.action || 'unknown');
  incrementCounter(metrics.extractionMethods, outcome.extractionMethod || 'none');
  if (outcome.persistedBodyText) {
    metrics.persistedBodyTextCount += 1;
  }
}

export async function enqueueRecordSummary(env, recordId, reason = 'record_updated', extraPayload = {}) {
  if (!env?.SUMMARY_QUEUE || !recordId) {
    return { queued: false, reason: 'queue_not_configured' };
  }

  const messagePayload = {
    recordId,
    reason,
    requestedAt: new Date().toISOString(),
    ...extraPayload
  };

  await env.SUMMARY_QUEUE.send(messagePayload);

  return { queued: true };
}

export async function processSummaryQueue(batch, env) {
  const runtimeState = createRuntimeState();

  for (const message of batch.messages) {
    const startedAt = Date.now();
    const payload = message.body || {};
    const recordId = payload.recordId || null;
    const offset = parseOffset(payload.offset);
    const storiesPerJob = getStoriesPerJob(env, payload);

    try {
      if (!recordId) {
        logSummaryEvent('ai_summary_queue_skipped', {
          status: 'ignored',
          reason: 'missing_record_id'
        });
        message.ack();
        continue;
      }

      if (runtimeState.subrequestLimited) {
        logSummaryEvent('ai_summary_queue_deferred', {
          status: 'deferred',
          recordId,
          reason: 'subrequest_limit'
        });
        message.retry();
        continue;
      }

      const nextChunk = await summarizeRecordChunk(recordId, env, { offset, storiesPerJob }, runtimeState);

      if (nextChunk.hasMore) {
        const enqueueResult = await enqueueRecordSummary(
          env,
          recordId,
          payload.reason || 'record_updated',
          {
            offset: nextChunk.nextOffset,
            storiesPerJob,
            requestedAt: payload.requestedAt || new Date().toISOString()
          }
        );

        if (!enqueueResult.queued) {
          throw new Error(`Failed to enqueue continuation chunk for record ${recordId}: ${enqueueResult.reason || 'unknown'}`);
        }
      }

      logSummaryEvent('ai_summary_queue_job', {
        status: 'ok',
        recordId,
        reason: payload.reason || 'record_updated',
        hasMore: !!nextChunk.hasMore,
        nextOffset: nextChunk.nextOffset ?? null,
        durationMs: Date.now() - startedAt,
        ...nextChunk.metrics
      });

      message.ack();
    } catch (error) {
      logSummaryEvent('ai_summary_queue_job', {
        status: 'failed',
        recordId,
        reason: payload.reason || 'record_updated',
        offset,
        storiesPerJob,
        durationMs: Date.now() - startedAt,
        error: serializeError(error)
      });
      console.error('Failed to process summary message:', error);
      message.retry();
    }
  }
}

async function summarizeRecordChunk(recordId, env, { offset = 0, storiesPerJob = DEFAULT_STORIES_PER_JOB } = {}, runtimeState = createRuntimeState()) {
  if (!env?.DB) {
    throw new Error('DB binding missing');
  }

  const record = await env.DB.prepare(
    `SELECT id, date, name, city, province, victims, deaths, injuries, devices_used, warnings
     FROM records
     WHERE id = ?`
  ).bind(recordId).first();

  if (!record) {
    return { hasMore: false };
  }

  const countResult = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM news_stories
     WHERE record_id = ?`
  ).bind(recordId).first();
  const totalStories = Number.parseInt(String(countResult?.total || 0), 10) || 0;

  const storiesResult = await env.DB.prepare(
    `SELECT id, url, body_text, ai_summary
     FROM news_stories
     WHERE record_id = ?
     ORDER BY id
     LIMIT ?
     OFFSET ?`
  ).bind(recordId, storiesPerJob, offset).all();

  const stories = storiesResult.results || [];
  const metrics = createChunkMetrics(recordId, offset, storiesPerJob, totalStories, stories.length);

  for (const story of stories) {
    const outcome = await refreshStorySummaryIfNeeded(env, story, runtimeState);
    recordStoryOutcome(metrics, outcome);
  }

  const nextOffset = offset + stories.length;
  if (totalStories > 0 && nextOffset < totalStories) {
    return {
      hasMore: true,
      nextOffset,
      metrics
    };
  }

  const refreshedResult = await env.DB.prepare(
    `SELECT id, url, body_text, ai_summary
     FROM news_stories
     WHERE record_id = ?
     ORDER BY id`
  ).bind(recordId).all();
  const refreshedStories = refreshedResult.results || [];

  const recordSummary = await buildRecordSummary(env, record, refreshedStories, runtimeState);
  metrics.synthesisMode = recordSummary.mode;
  metrics.synthesisSourceCount = recordSummary.sourceCount;
  metrics.synthesisOmittedCount = recordSummary.omittedCount;

  await env.DB.prepare(
    `UPDATE records SET ai_summary = ? WHERE id = ?`
  ).bind(recordSummary.text, recordId).run();

  return { hasMore: false, metrics };
}

async function refreshStorySummaryIfNeeded(env, story, runtimeState = createRuntimeState()) {
  const existingSummary = (story.ai_summary || '').trim();
  const hasCorruptPdfSummary = looksLikeBinaryPdfText(existingSummary);
  const shouldAttemptSummary =
    !existingSummary ||
    existingSummary === NO_TEXT_SUMMARY ||
    existingSummary === UNSAFE_URL_SUMMARY ||
    hasCorruptPdfSummary;
  if (!shouldAttemptSummary) {
    return {
      action: 'skipped_existing',
      extractionMethod: 'skipped',
      persistedBodyText: false
    };
  }

  const sourceType = classifySourceType(story.url || '');
  const extraction = await getStoryText(story, sourceType, env, runtimeState);
  const storyText = extraction.text;

  if (sourceType === 'social' && !storyText) {
    if (existingSummary !== SOCIAL_ONLY_SUMMARY) {
      await env.DB.prepare(
        `UPDATE news_stories SET ai_summary = ? WHERE id = ?`
      ).bind(SOCIAL_ONLY_SUMMARY, story.id).run();
    }
    return {
      action: 'social_only',
      extractionMethod: extraction.method,
      persistedBodyText: false
    };
  }

  if (!storyText) {
    const emptySummaryMessage = extraction.method === 'unsafe_url' ? UNSAFE_URL_SUMMARY : NO_TEXT_SUMMARY;
    if (existingSummary !== emptySummaryMessage) {
      await env.DB.prepare(
        `UPDATE news_stories SET ai_summary = ? WHERE id = ?`
      ).bind(emptySummaryMessage, story.id).run();
    }
    return {
      action: extraction.method === 'unsafe_url' ? 'unsafe_url' : 'no_text',
      extractionMethod: extraction.method,
      persistedBodyText: false
    };
  }

  let persistedBodyText = false;
  if (extraction.persistBodyText) {
    await env.DB.prepare(
      `UPDATE news_stories SET body_text = ? WHERE id = ?`
    ).bind(storyText.slice(0, MAX_STORY_TEXT_CHARS), story.id).run();
    persistedBodyText = true;
  }

  const summary = await summarizeStoryText(env, extraction.url || story.url, sourceType, storyText, runtimeState);
  if (!summary) {
    return {
      action: 'summary_failed',
      extractionMethod: extraction.method,
      persistedBodyText
    };
  }

  if (summary !== existingSummary) {
    await env.DB.prepare(
      `UPDATE news_stories SET ai_summary = ? WHERE id = ?`
    ).bind(summary, story.id).run();
    return {
      action: 'summary_updated',
      extractionMethod: extraction.method,
      persistedBodyText
    };
  }

  return {
    action: 'summary_unchanged',
    extractionMethod: extraction.method,
    persistedBodyText
  };
}

async function summarizeStoryText(env, url, sourceType, storyText, runtimeState) {
  if (runtimeState?.subrequestLimited) {
    return heuristicSummary(storyText);
  }

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

  const aiText = await runAiText(env, prompt, 450, runtimeState);
  return aiText || heuristicSummary(storyText);
}

async function buildRecordSummary(env, record, stories, runtimeState) {
  const credibility = getRecordCredibility(stories);
  const recordYear = extractYearOnly(record.date);

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

  const orderedRows = selectSourcesForSynthesis(sourceRows, MAX_STORIES_FOR_SYNTHESIS);

  const omittedCount = sourceRows.length - orderedRows.length;

  if (!isAiSummaryEnabled(env) || !env?.AI || runtimeState?.subrequestLimited) {
    return {
      text: buildNonAiSynthesis(record, credibility, orderedRows, omittedCount),
      mode: 'fallback',
      sourceCount: orderedRows.length,
      omittedCount
    };
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
    '- treat incident date from metadata as YEAR-ONLY; do not infer month/day unless sources explicitly provide them',
    '',
    `Record: ${record.name || ''} in ${record.city || ''}, ${record.province || ''} (${recordYear || 'unknown year'})`,
    `Incident year (authoritative, year precision only): ${recordYear || 'unknown'}`,
    `Victims/deaths/injuries: ${record.victims ?? ''}/${record.deaths ?? ''}/${record.injuries ?? ''}`,
    `Devices used: ${record.devices_used || 'N/A'}`,
    `Warnings: ${record.warnings || 'N/A'}`,
    `Credibility counts: credible=${credibility.credible}, social=${credibility.social}, other=${credibility.other}`,
    omittedCount > 0 ? `Only first ${orderedRows.length} sources provided; ${omittedCount} omitted for context limits.` : 'All sources included.',
    '',
    'Sources:',
    ...orderedRows.map((row, index) => `${index + 1}. [${row.sourceType}] ${row.url}\nSummary: ${row.summary || 'No summary available.'}`)
  ].join('\n');

  const aiText = await runAiText(env, prompt, 900, runtimeState);
  if (aiText) {
    return {
      text: aiText,
      mode: 'ai',
      sourceCount: orderedRows.length,
      omittedCount
    };
  }

  return {
    text: buildNonAiSynthesis(record, credibility, orderedRows, omittedCount),
    mode: 'fallback',
    sourceCount: orderedRows.length,
    omittedCount
  };
}

function buildNonAiSynthesis(record, credibility, rows, omittedCount) {
  const classification = credibility.classification;
  const recordYear = extractYearOnly(record.date);
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
    `Automated fallback summary for ${record.name || 'incident'} in ${record.city || 'unknown location'} (${recordYear || 'unknown year'}).`,
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

function selectSourcesForSynthesis(sourceRows, maxSources) {
  if (!Array.isArray(sourceRows) || sourceRows.length === 0) {
    return [];
  }

  const sorted = [...sourceRows].sort((a, b) => scoreSourceType(b.sourceType) - scoreSourceType(a.sourceType));
  const credibleRows = sorted.filter(row => row.sourceType === 'official' || row.sourceType === 'news');
  const otherRows = sorted.filter(row => row.sourceType === 'other');
  const socialRows = sorted.filter(row => row.sourceType === 'social');

  // If we only have social links, include as many as possible.
  if (credibleRows.length === 0 && otherRows.length === 0) {
    return socialRows.slice(0, maxSources);
  }

  // Primary budget goes to credible + other sources.
  const primaryRows = [...credibleRows, ...otherRows].slice(0, maxSources);
  let remaining = maxSources - primaryRows.length;
  if (remaining <= 0) {
    return primaryRows;
  }

  // Social sources are supplemental unless they are all we have.
  // Keep a small cap so high-volume social links do not crowd out higher-signal sources.
  const socialCap = credibleRows.length > 0 ? 2 : 4;
  const socialToInclude = Math.min(remaining, socialCap, socialRows.length);
  if (socialToInclude <= 0) {
    return primaryRows;
  }

  return [...primaryRows, ...socialRows.slice(0, socialToInclude)];
}

async function runAiText(env, prompt, maxTokens = 500, runtimeState) {
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
    markSubrequestLimited(runtimeState, error, 'ai_run');
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

function getSafePublicHttpUrl(rawUrl) {
  const validation = validateAndNormalizePublicHttpUrl(rawUrl);
  return validation.ok ? validation.url : '';
}

async function getStoryText(story, sourceType, env, runtimeState) {
  const rawExistingBodyText = normalizeText(story.body_text || '');
  const existingBodyText = looksLikeBinaryPdfText(rawExistingBodyText) ? '' : rawExistingBodyText;
  if (existingBodyText.length >= 500) {
    return {
      text: existingBodyText.slice(0, MAX_STORY_TEXT_CHARS),
      method: 'stored_body_text',
      url: story.url || '',
      persistBodyText: false
    };
  }

  const normalizedUrl = normalizeSourceUrl(story.url || '');
  const safeCandidates = [normalizedUrl, story.url || '']
    .map(getSafePublicHttpUrl)
    .filter(Boolean);
  const urlCandidates = Array.from(new Set(safeCandidates));

  let best = {
    text: existingBodyText.slice(0, MAX_STORY_TEXT_CHARS),
    method: existingBodyText ? 'stored_body_text_partial' : 'none',
    url: story.url || '',
    score: scoreExtraction(existingBodyText, existingBodyText ? 'stored_body_text_partial' : 'none')
  };

  if (runtimeState?.subrequestLimited) {
    return {
      text: (best.text || '').slice(0, MAX_STORY_TEXT_CHARS),
      method: best.method,
      url: story.url || '',
      persistBodyText: false
    };
  }

  if (urlCandidates.length === 0) {
    return {
      text: best.text,
      method: 'unsafe_url',
      url: '',
      persistBodyText: false
    };
  }

  for (const candidate of urlCandidates) {
    const extracted = await fetchAndExtractFromUrl(candidate, runtimeState);
    if (isBetterExtraction(extracted, best)) {
      best = extracted;
    }

    if (best.score >= 5 || runtimeState?.subrequestLimited) {
      break;
    }
  }

  const primaryFetchUrl = urlCandidates[0] || '';
  const shouldTryFallback = sourceType !== 'social' && primaryFetchUrl && !isProxyUrl(primaryFetchUrl) && !runtimeState?.subrequestLimited;
  if (shouldTryFallback && best.score < 4) {
    if (isSummarizeDaemonFallbackEnabled(env)) {
      const extracted = await fetchViaSummarizeDaemon(primaryFetchUrl, env, runtimeState);
      if (isBetterExtraction(extracted, best)) {
        best = extracted;
      }
    }

    if (isJinaFallbackEnabled(env) && !runtimeState?.subrequestLimited) {
      const extracted = await fetchViaJinaReader(primaryFetchUrl, runtimeState);
      if (isBetterExtraction(extracted, best)) {
        best = extracted;
      }
    }

    if (isMarkdownNewFallbackEnabled(env) && best.score < 4 && !runtimeState?.subrequestLimited) {
      const extracted = await fetchViaMarkdownNew(primaryFetchUrl, runtimeState);
      if (isBetterExtraction(extracted, best)) {
        best = extracted;
      }
    }
  }

  return {
    text: (best.text || '').slice(0, MAX_STORY_TEXT_CHARS),
    method: best.method,
    url: best.url || urlCandidates[0] || '',
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

async function fetchAndExtractFromUrl(url, runtimeState) {
  try {
    const fetched = await safeFetchPublicText(url, {
      maxBytes: MAX_SOURCE_FETCH_BYTES,
      headers: {
        'User-Agent': 'MassMurderCanadaBot/1.0 (+https://massmurdercanada.org)',
        'Accept': 'text/markdown, text/html;q=0.9, application/xhtml+xml;q=0.9, text/plain;q=0.8, */*;q=0.7'
      }
    });

    if (!fetched.ok) {
      return makeExtractionResult('', 'fetch_blocked', url);
    }

    const { response, text, finalUrl } = fetched;
    if (!response.ok) {
      return null;
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const contentDisposition = (response.headers.get('content-disposition') || '').toLowerCase();

    // Avoid decoding PDF/binary blobs as UTF-8 text; that creates gibberish summaries.
    if (looksLikePdfResponse(url, contentType, contentDisposition)) {
      return makeExtractionResult('', 'pdf_binary', url);
    }
    if (isLikelyBinaryContentType(contentType)) {
      return makeExtractionResult('', 'binary_content', url);
    }

    if (contentType.includes('text/markdown') || contentType.includes('text/plain')) {
      const markdownText = normalizeText(cleanMarkdownServiceOutput(text));
      return makeExtractionResult(markdownText, 'accept_markdown', finalUrl || url);
    }

    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      return makeExtractionResult(normalizeText(text), 'non_html_text', finalUrl || url);
    }

    const structured = extractStructuredTextFromHtml(text);
    const generic = extractTextFromHtml(text);

    const best = isBetterExtraction(structured, generic) ? structured : generic;
    return {
      ...best,
      url: finalUrl || url
    };
  } catch (error) {
    markSubrequestLimited(runtimeState, error, 'fetch_source', url);
    console.error(`Failed to fetch story URL ${url}:`, error);
    return null;
  }
}

async function fetchViaJinaReader(url, runtimeState) {
  try {
    const proxyUrl = `https://r.jina.ai/${url}`;
    const fetched = await safeFetchPublicText(proxyUrl, {
      maxBytes: MAX_SOURCE_FETCH_BYTES,
      headers: {
        'User-Agent': 'MassMurderCanadaBot/1.0 (+https://massmurdercanada.org)'
      }
    });

    if (!fetched.ok) {
      return null;
    }

    const { response, text } = fetched;
    if (!response.ok) {
      return null;
    }

    return makeExtractionResult(normalizeText(cleanMarkdownServiceOutput(text)), 'jina_reader', url);
  } catch (error) {
    markSubrequestLimited(runtimeState, error, 'fetch_jina', url);
    console.error(`Failed jina reader fallback for ${url}:`, error);
    return null;
  }
}

async function fetchViaMarkdownNew(url, runtimeState) {
  try {
    const fetched = await safeFetchPublicText('https://markdown.new/', {
      method: 'POST',
      maxBytes: MAX_SOURCE_FETCH_BYTES,
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

    if (!fetched.ok) {
      return null;
    }

    const { response, text } = fetched;
    if (!response.ok) {
      return null;
    }

    return makeExtractionResult(normalizeText(cleanMarkdownServiceOutput(text)), 'markdown_new', url);
  } catch (error) {
    markSubrequestLimited(runtimeState, error, 'fetch_markdown_new', url);
    console.error(`Failed markdown.new fallback for ${url}:`, error);
    return null;
  }
}

async function fetchViaSummarizeDaemon(url, env, runtimeState) {
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
      signal: AbortSignal.timeout(15000),
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
    markSubrequestLimited(runtimeState, error, 'fetch_summarize_daemon', url);
    console.error(`Failed summarize daemon fallback for ${url}:`, error);
    return null;
  }
}

async function fetchSummarizeEventsText(daemonBase, runId, headers) {
  try {
    const response = await fetch(`${daemonBase}/v1/summarize/${encodeURIComponent(runId)}/events`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15000)
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

  if (looksLikeBinaryPdfText(normalized)) {
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

function looksLikePdfResponse(url, contentType, contentDisposition = '') {
  const lowerType = String(contentType || '').toLowerCase();
  if (lowerType.includes('application/pdf')) {
    return true;
  }

  const lowerDisposition = String(contentDisposition || '').toLowerCase();
  if (lowerDisposition.includes('.pdf')) {
    return true;
  }

  return isPdfUrl(url);
}

function isPdfUrl(url) {
  try {
    const parsed = new URL(url || '');
    const path = String(parsed.pathname || '').toLowerCase();
    return path.endsWith('.pdf');
  } catch {
    return false;
  }
}

function isLikelyBinaryContentType(contentType) {
  const lower = String(contentType || '').toLowerCase();
  if (!lower) return false;
  if (lower.startsWith('text/')) return false;
  if (lower.includes('application/xhtml+xml')) return false;
  if (lower.includes('application/json')) return false;
  if (lower.includes('application/xml')) return false;
  if (lower.includes('application/javascript')) return false;
  if (lower.includes('application/rss+xml')) return false;
  if (lower.includes('application/atom+xml')) return false;

  return (
    lower.includes('application/pdf') ||
    lower.includes('application/octet-stream') ||
    lower.includes('application/zip') ||
    lower.includes('application/gzip') ||
    lower.includes('application/x-gzip') ||
    lower.includes('application/x-binary') ||
    lower.includes('image/') ||
    lower.includes('audio/') ||
    lower.includes('video/') ||
    lower.includes('font/')
  );
}

function looksLikeBinaryPdfText(text) {
  const normalized = normalizeText(text || '');
  if (!normalized || normalized.length < 40) {
    return false;
  }

  const lower = normalized.toLowerCase();
  if (!lower.includes('%pdf')) {
    return false;
  }

  const pdfSignals = [
    'endobj',
    'xref',
    'trailer',
    '/flatedecode',
    'startxref',
    ' obj <<',
    'stream',
    'endstream'
  ];
  const hits = pdfSignals.reduce((count, signal) => count + (lower.includes(signal) ? 1 : 0), 0);
  return hits >= 2;
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
