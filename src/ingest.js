/**
 * Agent-assisted story ingestion.
 *
 * Flow:
 * 1. Remote agent submits a URL.
 * 2. Worker extracts facts and proposes an existing record or a new record.
 * 3. Agent approves the worker proposal.
 * 4. Worker validates/deduplicates again, writes records/stories, and queues summary work.
 */

import * as Sentry from '@sentry/cloudflare';
import { enqueueRecordSummary } from './ai-summary.js';
import { classifySourceType } from './source-classification.js';
import { safeFetchPublicText, validateAndNormalizePublicHttpUrl } from './url-safety.js';

const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const MAX_BATCH_URLS = 5;
const MAX_EXTRACTED_TEXT_CHARS = 14000;
const MAX_AI_TEXT_CHARS = 9000;
const MAX_SOURCE_FETCH_BYTES = 2 * 1024 * 1024;
const MAX_TITLE_CHARS = 300;
const MAX_REASON_CHARS = 900;
const MAX_CANDIDATES_FOR_AI = 8;
const MAX_RECORD_SEARCH_QUERY_CHARS = 160;
const DEFAULT_RECORD_SEARCH_LIMIT = 20;
const MAX_RECORD_SEARCH_LIMIT = 100;
const DEFAULT_RECORD_SEARCH_DATE_WINDOW_DAYS = 30;
const MAX_RECORD_SEARCH_DATE_WINDOW_DAYS = 366;
const DEFAULT_WORKER_MIN_CONFIDENCE = 0.65;
const DEFAULT_AGENT_MIN_CONFIDENCE = 0.65;
const DEFAULT_CREATE_RECORD_MIN_CONFIDENCE = 0.7;
const DEFAULT_INGEST_RATE_LIMIT_PER_MINUTE = 60;

const ACTION_ATTACH_TO_RECORD = 'attach_to_record';
const ACTION_CREATE_RECORD = 'create_record';
const ACTION_NEEDS_REVIEW = 'needs_review';
const ACTION_DUPLICATE = 'duplicate';

const DATE_BASIS_EVENT = 'event';
const DATE_BASIS_PUBLICATION_FALLBACK = 'publication_fallback';
const DATE_BASIS_UNKNOWN = 'unknown';

const STATUS_WORKER_PROPOSED = 'worker_proposed';
const STATUS_NEEDS_REVIEW = 'needs_review';
const STATUS_DUPLICATE = 'duplicate';
const STATUS_APPLIED = 'applied';
const STATUS_REJECTED = 'rejected';

export function isIngestAPIPath(segments) {
  return Array.isArray(segments) && segments[2] === 'ingest';
}

export async function handleIngestAPI(request, env, method, segments) {
  const collection = segments[3];
  const proposalId = segments[4] || '';
  const action = segments[5] || '';

  try {
    const rateLimit = await checkIngestRateLimit(request, env);
    if (rateLimit) {
      return rateLimit;
    }

    if (collection === 'records' && proposalId === 'search' && method === 'GET') {
      return await searchRecords(request, env);
    }

    if (collection !== 'proposals') {
      return jsonResponse({ error: 'Invalid ingest resource' }, 400);
    }

    if (method === 'POST' && !proposalId) {
      return await createProposals(request, env);
    }

    if (method === 'GET' && !proposalId) {
      return await listProposals(request, env);
    }

    if (method === 'GET' && proposalId && !action) {
      return await getProposalResponse(env, proposalId);
    }

    if (method === 'POST' && proposalId && action === 'approve') {
      return await approveProposal(request, env, proposalId);
    }

    if (method === 'POST' && proposalId && action === 'reject') {
      return await rejectProposal(request, env, proposalId);
    }

    return jsonResponse({ error: 'Method not allowed' }, 405);
  } catch (error) {
    if (isMissingIngestSchemaError(error)) {
      return jsonResponse({
        error: 'Ingest schema is missing. Apply migrations 0004_ingest_proposals.sql and 0005_story_canonical_urls.sql first.'
      }, 412);
    }

    console.error('Ingest API error:', error);
    Sentry.captureException(error, { tags: { area: 'ingest' } });
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

async function checkIngestRateLimit(request, env) {
  if (!env?.AUTH_TOKENS) {
    return null;
  }

  const limit = parseIntegerInRange(
    env.INGEST_RATE_LIMIT_PER_MINUTE,
    DEFAULT_INGEST_RATE_LIMIT_PER_MINUTE,
    1,
    1000
  );
  const key = await buildRateLimitKey(request);
  const windowId = Math.floor(Date.now() / 60000);
  const storageKey = `ingest_rate:${key}:${windowId}`;

  try {
    const current = Number(await env.AUTH_TOKENS.get(storageKey));
    if (Number.isFinite(current) && current >= limit) {
      return jsonResponse({ error: 'Rate limit exceeded' }, 429);
    }

    await env.AUTH_TOKENS.put(storageKey, String((Number.isFinite(current) ? current : 0) + 1), {
      expirationTtl: 120
    });
  } catch (error) {
    console.warn('Ingest rate-limit check failed open:', error);
  }

  return null;
}

async function buildRateLimitKey(request) {
  const authorization = request.headers.get('Authorization') || '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const identifier = bearer || request.headers.get('CF-Connecting-IP') || 'unknown';
  const bytes = new TextEncoder().encode(identifier);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function createProposals(request, env) {
  const body = await readJsonBodySafe(request);
  const urls = normalizeUrlList(body);

  if (urls.length === 0) {
    return jsonResponse({ error: 'A url or urls array is required' }, 400);
  }

  if (urls.length > MAX_BATCH_URLS) {
    return jsonResponse({ error: `Too many URLs; maximum is ${MAX_BATCH_URLS}` }, 400);
  }

  const proposals = [];
  for (const rawUrl of urls) {
    const proposal = await createProposalForUrl(env, rawUrl);
    proposals.push(proposal);
  }

  return jsonResponse({
    success: true,
    count: proposals.length,
    proposals
  }, 201);
}

async function listProposals(request, env) {
  const requestUrl = new URL(request.url);
  const status = normalizeStatus(requestUrl.searchParams.get('status'));
  const limit = parseIntegerInRange(requestUrl.searchParams.get('limit'), 25, 1, 100);
  const offset = parseIntegerInRange(requestUrl.searchParams.get('offset'), 0, 0, 1000000);

  let result;
  if (status) {
    result = await env.DB.prepare(
      `SELECT *
       FROM story_ingest_proposals
       WHERE status = ?
       ORDER BY created_at DESC
       LIMIT ?
       OFFSET ?`
    ).bind(status, limit, offset).all();
  } else {
    result = await env.DB.prepare(
      `SELECT *
       FROM story_ingest_proposals
       ORDER BY created_at DESC
       LIMIT ?
       OFFSET ?`
    ).bind(limit, offset).all();
  }

  return jsonResponse({
    success: true,
    proposals: (result.results || []).map(serializeProposalRow)
  });
}

async function searchRecords(request, env) {
  const requestUrl = new URL(request.url);
  const search = parseRecordSearchParams(requestUrl.searchParams);
  if (!search.ok) {
    return jsonResponse({ error: search.error }, 400);
  }

  const result = await env.DB.prepare(
    `SELECT id, date, name, city, province, victims, deaths, injuries, devices_used
     FROM records
     ORDER BY date DESC, id
     LIMIT 2000`
  ).all();

  const candidates = searchRecordCandidates(result.results || [], search.value);

  return jsonResponse({
    success: true,
    filters: search.value.filters,
    candidates: candidates.slice(0, search.value.limit).map(serializeRecordCandidate)
  });
}

async function getProposalResponse(env, proposalId) {
  const proposal = await getProposal(env, proposalId);
  if (!proposal) {
    return jsonResponse({ error: 'Proposal not found' }, 404);
  }

  return jsonResponse({
    success: true,
    proposal: serializeProposalRow(proposal)
  });
}

async function approveProposal(request, env, proposalId) {
  const body = await readJsonBodySafe(request);
  const proposal = await getProposal(env, proposalId);
  if (!proposal) {
    return jsonResponse({ error: 'Proposal not found' }, 404);
  }

  if (proposal.status === STATUS_APPLIED) {
    return jsonResponse({
      success: true,
      status: STATUS_APPLIED,
      proposal: serializeProposalRow(proposal),
      message: 'Proposal has already been applied'
    });
  }

  if (proposal.status === STATUS_DUPLICATE) {
    return jsonResponse({
      success: false,
      status: STATUS_DUPLICATE,
      proposal: serializeProposalRow(proposal),
      message: 'URL is already attached to a record'
    }, 409);
  }

  if (proposal.status === STATUS_REJECTED) {
    return jsonResponse({
      success: false,
      status: STATUS_REJECTED,
      proposal: serializeProposalRow(proposal),
      message: 'Proposal has already been rejected'
    }, 409);
  }

  const agentConfidence = clamp(Number(body.agent_confidence ?? body.confidence), 0, 1);
  if (!Number.isFinite(agentConfidence)) {
    return jsonResponse({ error: 'agent_confidence between 0 and 1 is required' }, 400);
  }

  const agentReason = normalizeText(body.agent_reason || body.reason || '').slice(0, MAX_REASON_CHARS);
  const targetRecordId = normalizeRecordId(
    body.record_id || extractRecordIdFromRecordUrl(body.record_url) || proposal.proposed_record_id || ''
  );

  if (proposal.proposed_action === ACTION_CREATE_RECORD) {
    return await approveCreateRecordProposal(env, proposal, body, {
      agentConfidence,
      agentReason,
      targetRecordId
    });
  }

  if (!targetRecordId) {
    return await markProposalNeedsReview(env, proposal, {
      agentConfidence,
      agentReason,
      error: 'Agent approval did not include a record_id and the worker did not propose one.'
    });
  }

  const record = await findRecordForIngest(env, targetRecordId);
  if (!record) {
    return await markProposalNeedsReview(env, proposal, {
      agentConfidence,
      agentReason,
      error: `Approved record was not found: ${targetRecordId}`
    });
  }

  const workerRecordId = proposal.proposed_record_id || '';
  if (workerRecordId && targetRecordId !== workerRecordId) {
    return await markProposalNeedsReview(env, proposal, {
      agentConfidence,
      agentReason,
      error: `Agent approved ${targetRecordId}, but worker proposed ${workerRecordId}.`
    });
  }

  const workerConfidence = Number(proposal.worker_confidence);
  const minWorkerConfidence = getConfidenceThreshold(env, 'INGEST_WORKER_MIN_CONFIDENCE', DEFAULT_WORKER_MIN_CONFIDENCE);
  const minAgentConfidence = getConfidenceThreshold(env, 'INGEST_AGENT_MIN_CONFIDENCE', DEFAULT_AGENT_MIN_CONFIDENCE);

  if (proposal.status !== STATUS_WORKER_PROPOSED || workerConfidence < minWorkerConfidence || agentConfidence < minAgentConfidence) {
    return await markProposalNeedsReview(env, proposal, {
      agentConfidence,
      agentReason,
      error: `Confidence threshold not met. worker=${Number.isFinite(workerConfidence) ? workerConfidence : 0}, agent=${agentConfidence}.`
    });
  }

  const duplicate = await findExistingStoryByUrl(env, proposal.normalized_url, proposal.url);
  if (duplicate) {
    const updated = await updateProposalStatus(env, proposal.id, {
      status: STATUS_DUPLICATE,
      agentConfidence,
      agentReason,
      agentDecision: 'approve',
      decision: {
        duplicate_story_id: duplicate.id,
        duplicate_record_id: duplicate.record_id,
        duplicate_url: duplicate.url
      },
      error: null
    });

    return jsonResponse({
      success: false,
      status: STATUS_DUPLICATE,
      proposal: serializeProposalRow(updated),
      duplicate
    }, 409);
  }

  return await attachStoryAndApplyProposal(env, proposal, targetRecordId, {
    agentConfidence,
    agentReason,
    summaryReason: 'ingest_story_attached'
  });
}

async function approveCreateRecordProposal(env, proposal, body, approval) {
  const { agentConfidence, agentReason } = approval;
  const targetRecordId = approval.targetRecordId || normalizeRecordId(proposal.proposed_record_id || '');

  if (!targetRecordId) {
    return await markProposalNeedsReview(env, proposal, {
      agentConfidence,
      agentReason,
      error: 'Create-record proposal does not have a proposed record ID.'
    });
  }

  if (proposal.proposed_record_id && targetRecordId !== proposal.proposed_record_id) {
    return await markProposalNeedsReview(env, proposal, {
      agentConfidence,
      agentReason,
      error: `Agent approved ${targetRecordId}, but worker proposed new record ${proposal.proposed_record_id}.`
    });
  }

  const workerConfidence = Number(proposal.worker_confidence);
  const minWorkerConfidence = getConfidenceThreshold(env, 'INGEST_CREATE_RECORD_MIN_CONFIDENCE', DEFAULT_CREATE_RECORD_MIN_CONFIDENCE);
  const minAgentConfidence = getConfidenceThreshold(env, 'INGEST_AGENT_MIN_CONFIDENCE', DEFAULT_AGENT_MIN_CONFIDENCE);

  if (proposal.status !== STATUS_WORKER_PROPOSED || workerConfidence < minWorkerConfidence || agentConfidence < minAgentConfidence) {
    return await markProposalNeedsReview(env, proposal, {
      agentConfidence,
      agentReason,
      error: `Create-record confidence threshold not met. worker=${Number.isFinite(workerConfidence) ? workerConfidence : 0}, agent=${agentConfidence}.`
    });
  }

  const existingRecord = await findRecordForIngest(env, targetRecordId);
  if (existingRecord) {
    return await markProposalNeedsReview(env, proposal, {
      agentConfidence,
      agentReason,
      error: `Proposed new record ID already exists: ${targetRecordId}`
    });
  }

  const duplicate = await findExistingStoryByUrl(env, proposal.normalized_url, proposal.url);
  if (duplicate) {
    const updated = await updateProposalStatus(env, proposal.id, {
      status: STATUS_DUPLICATE,
      agentConfidence,
      agentReason,
      agentDecision: 'approve',
      decision: {
        duplicate_story_id: duplicate.id,
        duplicate_record_id: duplicate.record_id,
        duplicate_url: duplicate.url
      },
      error: null
    });

    return jsonResponse({
      success: false,
      status: STATUS_DUPLICATE,
      proposal: serializeProposalRow(updated),
      duplicate
    }, 409);
  }

  const record = buildRecordForCreate(proposal);
  if (!record.ok) {
    return await markProposalNeedsReview(env, proposal, {
      agentConfidence,
      agentReason,
      error: record.error
    });
  }

  await insertRecord(env, record.value);

  return await attachStoryAndApplyProposal(env, proposal, targetRecordId, {
    agentConfidence,
    agentReason,
    summaryReason: 'ingest_record_created',
    decision: {
      applied_record_id: targetRecordId,
      applied_record: record.value
    }
  });
}

async function attachStoryAndApplyProposal(env, proposal, targetRecordId, options) {
  const storyId = proposal.proposed_story_id || createStoryId();
  const bodyText = normalizeText(proposal.extracted_text || '');

  try {
    await env.DB.prepare(
      `INSERT INTO news_stories (id, record_id, url, canonical_url, body_text, ai_summary)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      storyId,
      targetRecordId,
      proposal.normalized_url,
      proposal.normalized_url,
      bodyText.length >= 320 ? bodyText.slice(0, MAX_EXTRACTED_TEXT_CHARS) : null,
      null
    ).run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const duplicate = await findExistingStoryByUrl(env, proposal.normalized_url, proposal.url);
      const updated = await updateProposalStatus(env, proposal.id, {
        status: STATUS_DUPLICATE,
        agentConfidence: options.agentConfidence,
        agentReason: options.agentReason,
        agentDecision: 'approve',
        decision: {
          duplicate_story_id: duplicate?.id || null,
          duplicate_record_id: duplicate?.record_id || null,
          duplicate_url: duplicate?.url || proposal.normalized_url
        },
        error: null
      });

      return jsonResponse({
        success: false,
        status: STATUS_DUPLICATE,
        proposal: serializeProposalRow(updated),
        duplicate
      }, 409);
    }

    throw error;
  }

  let summaryQueue = { queued: false, reason: 'queue_not_configured' };
  try {
    summaryQueue = await enqueueRecordSummary(env, targetRecordId, options.summaryReason || 'ingest_story_attached', {
      proposalId: proposal.id,
      storyId
    });
  } catch (error) {
    console.error('Failed to enqueue summary after ingest apply:', error);
    summaryQueue = { queued: false, reason: 'queue_error' };
  }

  const existingDecision = parseJsonObject(proposal.decision_json);
  const decision = mergeJson(existingDecision, options.decision || null);
  const nowIso = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE story_ingest_proposals
     SET status = ?,
         agent_decision = ?,
         agent_confidence = ?,
         agent_reason = ?,
         decision_json = ?,
         applied_at = ?,
         applied_story_id = ?,
         error = NULL,
         updated_at = ?
     WHERE id = ?`
  ).bind(
    STATUS_APPLIED,
    'approve',
    options.agentConfidence,
    options.agentReason || null,
    JSON.stringify(decision),
    nowIso,
    storyId,
    nowIso,
    proposal.id
  ).run();

  const updated = await getProposal(env, proposal.id);

  return jsonResponse({
    success: true,
    status: STATUS_APPLIED,
    story_id: storyId,
    record_id: targetRecordId,
    summary_queue: summaryQueue,
    proposal: serializeProposalRow(updated)
  });
}

async function rejectProposal(request, env, proposalId) {
  const body = await readJsonBodySafe(request);
  const proposal = await getProposal(env, proposalId);
  if (!proposal) {
    return jsonResponse({ error: 'Proposal not found' }, 404);
  }

  const agentConfidence = Number(body.agent_confidence ?? body.confidence);
  const agentReason = normalizeText(body.agent_reason || body.reason || '').slice(0, MAX_REASON_CHARS);
  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    `UPDATE story_ingest_proposals
     SET status = ?,
         agent_decision = ?,
         agent_confidence = ?,
         agent_reason = ?,
         updated_at = ?
     WHERE id = ?`
  ).bind(
    STATUS_REJECTED,
    'reject',
    Number.isFinite(agentConfidence) ? clamp(agentConfidence, 0, 1) : null,
    agentReason || null,
    nowIso,
    proposal.id
  ).run();

  const updated = await getProposal(env, proposal.id);

  return jsonResponse({
    success: true,
    status: STATUS_REJECTED,
    proposal: serializeProposalRow(updated)
  });
}

async function createProposalForUrl(env, rawUrl) {
  const validation = validateAndNormalizePublicHttpUrl(rawUrl);
  if (!validation.ok) {
    return {
      url: rawUrl,
      status: STATUS_NEEDS_REVIEW,
      error: validation.error
    };
  }

  const normalizedUrl = validation.url;
  const duplicate = await findExistingStoryByUrl(env, normalizedUrl, rawUrl);
  if (duplicate) {
    const proposal = await insertProposal(env, {
      url: rawUrl,
      normalizedUrl,
      status: STATUS_DUPLICATE,
      proposedAction: ACTION_DUPLICATE,
      workerConfidence: 1,
      workerReason: `URL is already attached to record ${duplicate.record_id}.`,
      decision: {
        duplicate_story_id: duplicate.id,
        duplicate_record_id: duplicate.record_id,
        duplicate_url: duplicate.url
      }
    });
    return serializeProposalRow(proposal);
  }

  const activeProposal = await findActiveProposalByUrl(env, normalizedUrl);
  if (activeProposal) {
    return serializeProposalRow(activeProposal);
  }

  const source = await fetchSourceContent(rawUrl || normalizedUrl);
  const facts = await extractIncidentFacts(env, normalizedUrl, source);
  const candidates = await findCandidateRecords(env, facts, source);
  const selected = await selectCandidateRecord(env, normalizedUrl, source, facts, candidates);

  const minConfidence = getConfidenceThreshold(env, 'INGEST_WORKER_MIN_CONFIDENCE', DEFAULT_WORKER_MIN_CONFIDENCE);
  const hasConfidentMatch = selected.recordId && selected.confidence >= minConfidence;
  const newRecordProposal = hasConfidentMatch ? null : buildProposedNewRecord(facts, source, env);
  const canProposeNewRecord = !!newRecordProposal;
  const status = hasConfidentMatch || canProposeNewRecord ? STATUS_WORKER_PROPOSED : STATUS_NEEDS_REVIEW;
  const proposedAction = hasConfidentMatch
    ? ACTION_ATTACH_TO_RECORD
    : canProposeNewRecord
      ? ACTION_CREATE_RECORD
      : ACTION_NEEDS_REVIEW;
  const proposedRecordId = hasConfidentMatch
    ? selected.recordId
    : canProposeNewRecord
      ? newRecordProposal.id
      : selected.recordId || null;
  const workerConfidence = hasConfidentMatch
    ? selected.confidence || 0
    : canProposeNewRecord
      ? newRecordProposal.confidence
      : selected.confidence || 0;
  const sourceType = classifySourceType(normalizedUrl);

  const decision = {
    source_type: sourceType,
    extraction_method: source.method,
    extraction_error: source.error || null,
    source_published_at: source.publishedAt || null,
    record_date_basis: newRecordProposal?.dateBasis || null,
    selected_record_id: hasConfidentMatch ? selected.recordId : null,
    closest_candidate_id: !hasConfidentMatch ? selected.recordId || null : null,
    proposed_record: newRecordProposal?.record || null,
    candidate_count: candidates.length,
    top_candidates: candidates.slice(0, MAX_CANDIDATES_FOR_AI).map(candidate => ({
      id: candidate.id,
      name: candidate.name,
      city: candidate.city,
      province: candidate.province,
      date: candidate.date,
      score: candidate.score,
      reasons: candidate.reasons
    })),
    facts
  };

  const workerReason = hasConfidentMatch
    ? selected.reason
    : canProposeNewRecord
      ? newRecordProposal.reason
      : selected.reason || (
          source.error
            ? `Could not extract enough source text: ${source.error}`
            : 'No existing record matched the extracted facts with enough confidence.'
        );

  const proposal = await insertProposal(env, {
    url: rawUrl,
    normalizedUrl,
    status,
    proposedAction,
    proposedRecordId,
    proposedStoryId: createStoryId(),
    workerConfidence,
    workerReason,
    extractedTitle: source.title,
    extractedText: source.text,
    extractedFacts: facts,
    decision,
    error: status === STATUS_NEEDS_REVIEW ? workerReason : null
  });

  return serializeProposalRow(proposal);
}

async function insertProposal(env, input) {
  const id = createProposalId();
  const nowIso = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO story_ingest_proposals (
         id, url, normalized_url, status, proposed_action, proposed_record_id,
         proposed_story_id, worker_confidence, worker_reason, extracted_title,
         extracted_text, extracted_facts_json, decision_json, error,
         created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      input.url || input.normalizedUrl,
      input.normalizedUrl,
      input.status,
      input.proposedAction || null,
      input.proposedRecordId || null,
      input.proposedStoryId || null,
      Number.isFinite(Number(input.workerConfidence)) ? clamp(Number(input.workerConfidence), 0, 1) : null,
      input.workerReason ? String(input.workerReason).slice(0, MAX_REASON_CHARS) : null,
      input.extractedTitle ? String(input.extractedTitle).slice(0, MAX_TITLE_CHARS) : null,
      input.extractedText ? String(input.extractedText).slice(0, MAX_EXTRACTED_TEXT_CHARS) : null,
      JSON.stringify(input.extractedFacts || null),
      JSON.stringify(input.decision || null),
      input.error ? String(input.error).slice(0, MAX_REASON_CHARS) : null,
      nowIso,
      nowIso
    ).run();
  } catch (error) {
    if (isUniqueConstraintError(error) && input.normalizedUrl) {
      const existing = await findActiveProposalByUrl(env, input.normalizedUrl);
      if (existing) {
        return existing;
      }
    }
    throw error;
  }

  return await getProposal(env, id);
}

function buildProposedNewRecord(facts, source, env) {
  const confidence = clamp(Number(facts?.confidence), 0, 1);
  const minConfidence = getConfidenceThreshold(env, 'INGEST_CREATE_RECORD_MIN_CONFIDENCE', DEFAULT_CREATE_RECORD_MIN_CONFIDENCE);
  if (!Number.isFinite(confidence) || confidence < minConfidence) {
    return null;
  }

  const eventDate = normalizeIncidentDate(facts.incident_date, source.text);
  const eventYear = isPublicationFallbackYear(facts) ? '' : normalizeYear(facts.year);
  const publishedYear = extractYearOnly(source.publishedAt);
  const recordDate = eventDate || eventYear || publishedYear;
  const dateBasis = eventDate
    ? 'event_date'
    : eventYear
      ? 'event_year'
      : publishedYear
        ? DATE_BASIS_PUBLICATION_FALLBACK
        : DATE_BASIS_UNKNOWN;
  const year = extractYearOnly(recordDate);
  const city = nullableString(facts.city);
  const province = normalizeProvince(facts.province);
  const victims = nullableNumber(facts.victims);
  const deaths = nullableNumber(facts.deaths);
  const injuries = nullableNumber(facts.injuries);

  if (!source.text || !year || !city || !isCanadianProvinceCode(province)) {
    return null;
  }

  if (!qualifiesForRecord(victims, deaths)) {
    return null;
  }

  const id = createUuid();
  const name = deriveRecordName(facts, source);
  const devicesUsed = nullableString(facts.devices_used);
  const record = {
    id,
    date: recordDate,
    name,
    city,
    province,
    licensed: null,
    victims,
    deaths,
    injuries,
    suicide: null,
    devices_used: devicesUsed,
    firearms: inferFirearms(facts),
    possessed_legally: null,
    warnings: null,
    oic_impact: null,
    ai_summary: null
  };

  return {
    id,
    record,
    dateBasis,
    confidence,
    reason: `No existing record matched above threshold; extracted source facts support creating ${name} in ${city}, ${province} (${year}${dateBasis === DATE_BASIS_PUBLICATION_FALLBACK ? ', publication-year fallback' : ''}).`
  };
}

function buildRecordForCreate(proposal) {
  const decision = parseJsonObject(proposal.decision_json) || {};
  const proposedRecord = decision.proposed_record || null;
  if (!proposedRecord || typeof proposedRecord !== 'object') {
    return { ok: false, error: 'Create-record proposal does not include proposed_record details.' };
  }

  const recordId = normalizeRecordId(proposal.proposed_record_id || proposedRecord.id || '');
  if (!recordId) {
    return { ok: false, error: 'Create-record proposal has an invalid record ID.' };
  }

  const merged = { ...proposedRecord, id: recordId };

  const recordDate = normalizeRecordDate(merged.date) || normalizeYear(merged.date);
  if (!recordDate) {
    return { ok: false, error: 'New record requires a date with at least a four-digit year.' };
  }

  const city = nullableString(merged.city);
  const province = normalizeProvince(merged.province);
  const victims = nullableNumber(merged.victims);
  const deaths = nullableNumber(merged.deaths);

  if (!city || !isCanadianProvinceCode(province)) {
    return { ok: false, error: 'New record requires city and province.' };
  }

  if (!qualifiesForRecord(victims, deaths)) {
    return { ok: false, error: 'New record requires at least two victims or deaths.' };
  }

  return {
    ok: true,
    value: {
      id: recordId,
      date: recordDate,
      name: nullableString(merged.name) || 'Unknown',
      city,
      province,
      licensed: nullableBooleanNumber(merged.licensed),
      victims,
      deaths,
      injuries: nullableNumber(merged.injuries),
      suicide: nullableBooleanNumber(merged.suicide),
      devices_used: nullableString(merged.devices_used),
      firearms: nullableBooleanNumber(merged.firearms),
      possessed_legally: nullableBooleanNumber(merged.possessed_legally),
      warnings: nullableString(merged.warnings),
      oic_impact: nullableBooleanNumber(merged.oic_impact),
      ai_summary: null
    }
  };
}

async function insertRecord(env, record) {
  await env.DB.prepare(
    `INSERT INTO records (id, date, name, city, province, licensed, victims,
                         deaths, injuries, suicide, devices_used, firearms,
                         possessed_legally, warnings, oic_impact, ai_summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    record.id,
    record.date || null,
    record.name || null,
    record.city || null,
    record.province || null,
    record.licensed,
    record.victims,
    record.deaths,
    record.injuries,
    record.suicide,
    record.devices_used || null,
    record.firearms,
    record.possessed_legally,
    record.warnings || null,
    record.oic_impact,
    record.ai_summary || null
  ).run();
}

function qualifiesForRecord(victims, deaths) {
  const victimCount = Number(victims);
  const deathCount = Number(deaths);
  return (
    (Number.isFinite(victimCount) && victimCount >= 2) ||
    (Number.isFinite(deathCount) && deathCount >= 2)
  );
}

function deriveRecordName(facts, source) {
  const recordName = nullableString(facts.record_name);
  if (recordName) {
    return recordName.slice(0, 120);
  }

  const suspectName = nullableString(facts.suspect_name);
  if (suspectName) {
    const parts = suspectName.split(/\s+/).filter(Boolean);
    return (parts.at(-1) || suspectName).slice(0, 120);
  }

  const incidentName = nullableString(facts.incident_name);
  if (incidentName && !looksGenericIncidentName(incidentName)) {
    return incidentName.slice(0, 120);
  }

  return 'Unknown';
}

function looksGenericIncidentName(name) {
  const normalized = normalizeComparable(name);
  return (
    normalized === 'murder of 2 children' ||
    normalized === 'murder of two children' ||
    normalized === 'deaths of 2 children' ||
    normalized === 'deaths of two children' ||
    normalized === 'double homicide'
  );
}

function sourceSupportsName(name, sourceText = '') {
  const normalizedName = normalizeComparable(name);
  if (!normalizedName || looksGenericPersonLabel(normalizedName)) {
    return false;
  }

  const normalizedSource = normalizeComparable(sourceText);
  if (!normalizedSource) {
    return false;
  }

  if (normalizedSource.includes(normalizedName)) {
    return true;
  }

  const parts = normalizedName.split(/\s+/).filter(part => part.length >= 3);
  return parts.length > 1 && parts.every(part => normalizedSource.includes(part));
}

function sourceSupportsIncidentName(name, sourceText = '') {
  const normalizedName = normalizeComparable(name);
  if (!normalizedName || looksGenericIncidentName(normalizedName)) {
    return false;
  }

  const normalizedSource = normalizeComparable(sourceText);
  return !!normalizedSource && normalizedSource.includes(normalizedName);
}

function looksGenericPersonLabel(normalizedName) {
  return [
    'father',
    'calgary father',
    'man',
    'accused',
    'suspect',
    'unknown',
    'unnamed',
    'the father',
    'the accused',
    'the suspect'
  ].includes(normalizedName);
}

function inferFirearms(facts) {
  if (facts.firearms === true) return 1;
  if (facts.firearms === false) return 0;
  const devices = normalizeComparable(facts.devices_used || '');
  if (!devices) return null;
  if (devices.includes('firearm') || devices.includes('gun') || devices.includes('rifle') || devices.includes('shotgun') || devices.includes('pistol')) {
    return 1;
  }
  return 0;
}

async function markProposalNeedsReview(env, proposal, details) {
  const updated = await updateProposalStatus(env, proposal.id, {
    status: STATUS_NEEDS_REVIEW,
    agentConfidence: details.agentConfidence,
    agentReason: details.agentReason,
    agentDecision: 'approve',
    error: details.error,
    decision: {
      previous_status: proposal.status,
      proposed_record_id: proposal.proposed_record_id || null,
      review_reason: details.error || 'Needs human review.'
    }
  });

  return jsonResponse({
    success: false,
    status: STATUS_NEEDS_REVIEW,
    proposal: serializeProposalRow(updated),
    message: details.error || 'Proposal requires human review before applying.'
  }, 202);
}

async function updateProposalStatus(env, proposalId, input) {
  const nowIso = new Date().toISOString();
  const existing = await getProposal(env, proposalId);
  const decision = mergeJson(
    parseJsonObject(existing?.decision_json),
    input.decision || null
  );

  await env.DB.prepare(
    `UPDATE story_ingest_proposals
     SET status = ?,
         agent_decision = COALESCE(?, agent_decision),
         agent_confidence = COALESCE(?, agent_confidence),
         agent_reason = COALESCE(?, agent_reason),
         decision_json = ?,
         error = ?,
         updated_at = ?
     WHERE id = ?`
  ).bind(
    input.status,
    input.agentDecision || null,
    Number.isFinite(Number(input.agentConfidence)) ? clamp(Number(input.agentConfidence), 0, 1) : null,
    input.agentReason || null,
    JSON.stringify(decision),
    input.error ? String(input.error).slice(0, MAX_REASON_CHARS) : null,
    nowIso,
    proposalId
  ).run();

  return await getProposal(env, proposalId);
}

async function getProposal(env, proposalId) {
  if (!isSafeId(proposalId)) {
    return null;
  }

  return await env.DB.prepare(
    `SELECT *
     FROM story_ingest_proposals
     WHERE id = ?`
  ).bind(proposalId).first();
}

async function findExistingStoryByUrl(env, normalizedUrl, rawUrl) {
  const candidates = buildUrlLookupVariants(normalizedUrl, rawUrl);
  if (candidates.length === 0) {
    return null;
  }

  const placeholders = candidates.map(() => '?').join(', ');

  return await env.DB.prepare(
    `SELECT ns.id, ns.record_id, ns.url, r.name AS record_name
     FROM news_stories ns
     LEFT JOIN records r ON r.id = ns.record_id
     WHERE ns.canonical_url IN (${placeholders}) OR ns.url IN (${placeholders})
     LIMIT 1`
  ).bind(...candidates, ...candidates).first();
}

function buildUrlLookupVariants(...urls) {
  const variants = new Set();

  for (const input of urls) {
    if (!input) continue;

    const raw = String(input).trim();
    if (!raw) continue;

    addUrlVariant(variants, raw);

    const validated = validateAndNormalizePublicHttpUrl(raw);
    if (validated.ok && validated.url) {
      addUrlVariant(variants, validated.url);
    }
  }

  return Array.from(variants).slice(0, 8);
}

function addUrlVariant(variants, value) {
  variants.add(value);

  try {
    const parsed = new URL(value);
    parsed.hash = '';
    variants.add(parsed.toString());

    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
      variants.add(parsed.toString());
    } else if (parsed.pathname.length > 1) {
      parsed.pathname = `${parsed.pathname}/`;
      variants.add(parsed.toString());
    }
  } catch {
    // Keep the raw string variant only.
  }
}

async function findActiveProposalByUrl(env, normalizedUrl) {
  if (!normalizedUrl) {
    return null;
  }

  return await env.DB.prepare(
    `SELECT *
     FROM story_ingest_proposals
     WHERE normalized_url = ?
       AND status IN (?, ?)
     ORDER BY created_at DESC
     LIMIT 1`
  ).bind(normalizedUrl, STATUS_WORKER_PROPOSED, STATUS_NEEDS_REVIEW).first();
}

async function findRecordForIngest(env, recordId) {
  if (!isSafeId(recordId)) {
    return null;
  }

  return await env.DB.prepare(
    `SELECT id, date, name, city, province, victims, deaths, injuries, devices_used
     FROM records
     WHERE id = ?`
  ).bind(recordId).first();
}

async function findCandidateRecords(env, facts, source) {
  const result = await env.DB.prepare(
    `SELECT id, date, name, city, province, victims, deaths, injuries, devices_used, ai_summary
     FROM records
     ORDER BY date DESC, id
     LIMIT 1000`
  ).all();

  const sourceText = normalizeText([
    source.title,
    source.text
  ].filter(Boolean).join(' ')).toLowerCase();

  return (result.results || [])
    .map(record => scoreRecordCandidate(record, facts, sourceText))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

function parseRecordSearchParams(searchParams) {
  const q = normalizeText(searchParams.get('q') || searchParams.get('query') || '');
  if (q.length > MAX_RECORD_SEARCH_QUERY_CHARS) {
    return { ok: false, error: `q must be ${MAX_RECORD_SEARCH_QUERY_CHARS} characters or fewer` };
  }

  const city = normalizeText(searchParams.get('city') || '');
  if (city.length > 120) {
    return { ok: false, error: 'city must be 120 characters or fewer' };
  }

  const rawProvince = normalizeText(searchParams.get('province') || '');
  const province = normalizeProvince(rawProvince);
  if (rawProvince && (!province || !isCanadianProvinceCode(province))) {
    return { ok: false, error: 'province must be a Canadian province or territory code/name' };
  }

  const rawYear = normalizeText(searchParams.get('year') || '');
  const year = normalizeYear(rawYear);
  if (rawYear && !year) {
    return { ok: false, error: 'year must include a four-digit year' };
  }

  const rawDate = normalizeText(searchParams.get('date') || '');
  const date = rawDate ? normalizeSearchDate(rawDate) : '';
  if (rawDate && !date) {
    return { ok: false, error: 'date must be YYYY-MM-DD, a month/day/year date, or a four-digit year' };
  }

  const victims = parseSearchCount(searchParams, 'victims');
  if (!victims.ok) return victims;

  const deaths = parseSearchCount(searchParams, 'deaths');
  if (!deaths.ok) return deaths;

  const injuries = parseSearchCount(searchParams, 'injuries');
  if (!injuries.ok) return injuries;

  const limit = parseIntegerInRange(
    searchParams.get('limit'),
    DEFAULT_RECORD_SEARCH_LIMIT,
    1,
    MAX_RECORD_SEARCH_LIMIT
  );
  const dateWindowDays = parseIntegerInRange(
    searchParams.get('date_window_days'),
    DEFAULT_RECORD_SEARCH_DATE_WINDOW_DAYS,
    0,
    MAX_RECORD_SEARCH_DATE_WINDOW_DAYS
  );
  const dateInfo = parseDateText(date);
  const effectiveYear = year || dateInfo.year || '';

  const filters = compactObject({
    q: q || null,
    city: city || null,
    province: province || null,
    year: year || null,
    date: date || null,
    date_window_days: dateInfo.exact ? dateWindowDays : null,
    victims: victims.value,
    deaths: deaths.value,
    injuries: injuries.value
  });

  if (Object.keys(filters).length === 0) {
    return {
      ok: false,
      error: 'At least one search filter is required: q, city, province, year, date, victims, deaths, or injuries'
    };
  }

  return {
    ok: true,
    value: {
      q: q || '',
      city: city || '',
      province: province || '',
      year: effectiveYear,
      requestedYear: year || '',
      date,
      exactDate: dateInfo.exact || '',
      dateWindowDays,
      victims: victims.value,
      deaths: deaths.value,
      injuries: injuries.value,
      limit,
      filters
    }
  };
}

function normalizeSearchDate(rawDate) {
  const text = normalizeText(rawDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) && !isValidIsoDate(text)) {
    return '';
  }
  return normalizeRecordDate(text);
}

function parseSearchCount(searchParams, key) {
  const rawValue = searchParams.get(key);
  if (rawValue === null || rawValue === '') {
    return { ok: true, value: null };
  }

  const number = Number(rawValue);
  if (!Number.isInteger(number) || number < 0 || number > 999) {
    return { ok: false, error: `${key} must be an integer from 0 to 999` };
  }

  return { ok: true, value: number };
}

function searchRecordCandidates(records, search) {
  const sourceText = normalizeComparable([
    search.q,
    search.city,
    search.province,
    search.date,
    search.year
  ].filter(Boolean).join(' ')).toLowerCase();
  const facts = searchFacts(search);

  return (records || [])
    .filter(record => recordMatchesSearchFilters(record, search))
    .map(record => scoreSearchRecordCandidate(record, facts, sourceText, search))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => sortSearchCandidates(a, b, search));
}

function searchFacts(search) {
  return {
    incident_name: search.q || null,
    name: search.q || null,
    incident_date: search.exactDate || null,
    year: search.year || null,
    date_basis: search.exactDate || search.year ? DATE_BASIS_EVENT : DATE_BASIS_UNKNOWN,
    city: search.city || null,
    province: search.province || null,
    victims: search.victims,
    deaths: search.deaths,
    injuries: search.injuries,
    devices_used: search.q || null
  };
}

function recordMatchesSearchFilters(record, search) {
  const recordProvince = normalizeProvince(record.province);
  if (search.province && recordProvince !== search.province) {
    return false;
  }

  const recordCity = normalizeComparable(record.city);
  const searchCity = normalizeComparable(search.city);
  if (searchCity && recordCity !== searchCity) {
    return false;
  }

  const recordDate = parseRecordDateInfo(record.date);
  if (search.requestedYear && recordDate.year !== search.requestedYear) {
    return false;
  }

  if (search.exactDate) {
    if (!recordDate.year || recordDate.year !== search.exactDate.slice(0, 4)) {
      return false;
    }
    if (recordDate.exact && Math.abs(daysBetween(recordDate.exact, search.exactDate)) > search.dateWindowDays) {
      return false;
    }
  } else if (search.date && recordDate.year !== search.year) {
    return false;
  }

  if (!countCompatible(record.victims, search.victims)) {
    return false;
  }
  if (!countCompatible(record.deaths, search.deaths)) {
    return false;
  }
  if (!countCompatible(record.injuries, search.injuries)) {
    return false;
  }

  return true;
}

function countCompatible(recordValue, searchValue) {
  if (searchValue === null || searchValue === undefined) {
    return true;
  }

  const recordNumber = Number(recordValue);
  return !Number.isFinite(recordNumber) || recordNumber === searchValue;
}

function scoreSearchRecordCandidate(record, facts, sourceText, search) {
  const candidate = scoreRecordCandidate(record, facts, sourceText);
  const queryScore = scoreRecordQueryMatch(record, search.q, candidate.reasons);
  return {
    ...candidate,
    score: clamp(candidate.score + queryScore, 0, 1)
  };
}

function scoreRecordQueryMatch(record, query, reasons) {
  const normalizedQuery = normalizeComparable(query);
  if (!normalizedQuery) {
    return 0;
  }

  const haystack = normalizeComparable([
    record.name,
    record.city,
    record.province,
    record.date,
    record.devices_used
  ].filter(Boolean).join(' '));
  if (!haystack) {
    return 0;
  }

  if (haystack.includes(normalizedQuery)) {
    reasons.push('query');
    return 0.16;
  }

  const queryTokens = normalizedQuery.split(/\s+/).filter(token => token.length >= 3);
  if (queryTokens.length > 1 && queryTokens.every(token => haystack.includes(token))) {
    reasons.push('query_terms');
    return 0.08;
  }

  return 0;
}

function sortSearchCandidates(a, b, search) {
  const scoreDiff = b.score - a.score;
  if (Math.abs(scoreDiff) > 0.0001) {
    return scoreDiff;
  }

  if (search.exactDate) {
    const aInfo = parseRecordDateInfo(a.date);
    const bInfo = parseRecordDateInfo(b.date);
    const aDiff = aInfo.exact ? Math.abs(daysBetween(aInfo.exact, search.exactDate)) : 9999;
    const bDiff = bInfo.exact ? Math.abs(daysBetween(bInfo.exact, search.exactDate)) : 9999;
    if (aDiff !== bDiff) {
      return aDiff - bDiff;
    }
  }

  return String(b.date || '').localeCompare(String(a.date || '')) || String(a.id || '').localeCompare(String(b.id || ''));
}

function serializeRecordCandidate(candidate) {
  return {
    id: candidate.id,
    date: candidate.date,
    name: candidate.name,
    city: candidate.city,
    province: candidate.province,
    victims: candidate.victims,
    deaths: candidate.deaths,
    injuries: candidate.injuries,
    devices_used: candidate.devices_used,
    score: Number(candidate.score.toFixed(3)),
    reasons: candidate.reasons
  };
}

function scoreRecordCandidate(record, facts, sourceText) {
  const reasons = [];
  let score = 0;

  score += scoreDateMatch(record.date, facts, reasons, sourceText);

  const recordProvince = normalizeProvince(record.province);
  const factProvince = normalizeProvince(facts.province);
  if (recordProvince && factProvince && recordProvince === factProvince) {
    score += 0.14;
    reasons.push('province');
  }

  const recordCity = normalizeComparable(record.city);
  const factCity = normalizeComparable(facts.city);
  if (recordCity && factCity && recordCity === factCity) {
    score += 0.18;
    reasons.push('city');
  } else if (recordCity && sourceText.includes(recordCity)) {
    score += 0.1;
    reasons.push('city_in_source');
  }

  const recordName = normalizeComparable(record.name);
  const factName = normalizeComparable(facts.incident_name || facts.name || '');
  if (recordName && factName && (recordName.includes(factName) || factName.includes(recordName))) {
    score += 0.22;
    reasons.push('name');
  } else if (recordName && sourceText.includes(recordName)) {
    score += 0.18;
    reasons.push('name_in_source');
  }

  score += scoreNumberMatch(record.victims, facts.victims, 'victims', reasons, 0.08);
  score += scoreNumberMatch(record.deaths, facts.deaths, 'deaths', reasons, 0.08);
  score += scoreNumberMatch(record.injuries, facts.injuries, 'injuries', reasons, 0.04);

  const devices = normalizeComparable(record.devices_used);
  const factDevices = normalizeComparable(facts.devices_used || facts.weapon || '');
  if (devices && factDevices && (devices.includes(factDevices) || factDevices.includes(devices))) {
    score += 0.04;
    reasons.push('devices');
  }

  return {
    ...record,
    score: clamp(score, 0, 1),
    reasons
  };
}

function scoreNumberMatch(recordValue, factValue, reason, reasons, weight) {
  const recordNumber = Number(recordValue);
  const factNumber = Number(factValue);
  if (!Number.isFinite(recordNumber) || !Number.isFinite(factNumber)) {
    return 0;
  }

  if (recordNumber === factNumber) {
    reasons.push(reason);
    return weight;
  }

  return 0;
}

function scoreDateMatch(recordDate, facts, reasons, sourceText = '') {
  const recordInfo = parseRecordDateInfo(recordDate);
  const incidentInfo = parseIncidentDateInfo(facts, sourceText);
  const incidentYear = incidentInfo.year;

  if (!recordInfo.year || !incidentYear) {
    return 0;
  }

  if (recordInfo.year !== incidentYear) {
    reasons.push('year_conflict');
    return -0.18;
  }

  if (recordInfo.exact && incidentInfo.exact) {
    const diffDays = Math.abs(daysBetween(recordInfo.exact, incidentInfo.exact));
    if (diffDays <= 3) {
      reasons.push('event_date');
      return 0.34;
    }
    if (diffDays <= 30) {
      reasons.push('near_event_date');
      return 0.26;
    }

    reasons.push('event_date_conflict');
    return -0.12;
  }

  if (incidentInfo.exact) {
    reasons.push('year_from_event_date');
    return 0.2;
  }

  reasons.push('year');
  return 0.18;
}

async function selectCandidateRecord(env, url, source, facts, candidates) {
  const top = candidates.slice(0, MAX_CANDIDATES_FOR_AI);
  const heuristicBest = top[0] || null;

  if (!env?.AI || !source.text || top.length === 0) {
    return {
      recordId: heuristicBest?.id || null,
      confidence: heuristicBest?.score || 0,
      reason: heuristicBest
        ? `Heuristic match on ${heuristicBest.reasons.join(', ') || 'source facts'}.`
        : 'No candidate records found.'
    };
  }

  const prompt = [
    'Decide whether the source article belongs to one existing incident record.',
    'Return strict JSON only with keys:',
    '{"record_id": string|null, "confidence": number, "reasoning": string}',
    'Rules:',
    '- Choose a record only if the source and record describe the same incident.',
    '- Give strong weight to matching event dates; if the source event date conflicts with a record date, treat it as likely different.',
    '- Do not treat the article publication date as an event date.',
    '- Use record year as year-only metadata; do not require exact month/day.',
    '- If the article is about a different incident, return record_id null and confidence <= 0.4.',
    '- Confidence must be between 0 and 1.',
    '',
    `URL: ${url}`,
    `Title: ${source.title || 'Unknown'}`,
    `Extracted facts: ${JSON.stringify(facts)}`,
    '',
    'Candidate records:',
    ...top.map((candidate, index) => [
      `${index + 1}. id=${candidate.id}`,
      `name=${candidate.name || ''}`,
      `date=${candidate.date || ''}`,
      `city=${candidate.city || ''}`,
      `province=${candidate.province || ''}`,
      `victims/deaths/injuries=${candidate.victims ?? ''}/${candidate.deaths ?? ''}/${candidate.injuries ?? ''}`,
      `devices=${candidate.devices_used || ''}`,
      `heuristic_score=${candidate.score}`,
      `heuristic_reasons=${candidate.reasons.join(', ')}`
    ].join(' | ')),
    '',
    'Article excerpt:',
    source.text.slice(0, MAX_AI_TEXT_CHARS)
  ].join('\n');

  const aiJson = await runAiJson(env, prompt, 420);
  const aiRecordId = normalizeRecordId(aiJson?.record_id || '');
  const aiConfidence = clamp(Number(aiJson?.confidence), 0, 1);
  const aiReason = normalizeText(aiJson?.reasoning || '').slice(0, MAX_REASON_CHARS);

  const aiCandidate = top.find(candidate => candidate.id === aiRecordId);
  if (aiCandidate && candidateHardFieldsCompatible(aiCandidate, facts)) {
    return {
      recordId: aiRecordId,
      confidence: Number.isFinite(aiConfidence) ? aiConfidence : heuristicBest?.score || 0,
      reason: `Heuristic match on ${aiCandidate.reasons.join(', ') || 'source facts'}; AI agreed.`
    };
  }

  return {
    recordId: heuristicBest?.id || null,
    confidence: Math.min(heuristicBest?.score || 0, 0.6),
    reason: aiReason || 'AI did not select a confident matching record.'
  };
}

function candidateHardFieldsCompatible(candidate, facts) {
  const candidateProvince = normalizeProvince(candidate.province);
  const factProvince = normalizeProvince(facts.province);
  if (candidateProvince && factProvince && candidateProvince !== factProvince) {
    return false;
  }

  const candidateCity = normalizeComparable(candidate.city);
  const factCity = normalizeComparable(facts.city);
  if (candidateCity && factCity && candidateCity !== factCity) {
    return false;
  }

  const candidateVictims = Number(candidate.victims);
  const factVictims = Number(facts.victims);
  if (Number.isFinite(candidateVictims) && Number.isFinite(factVictims) && Math.abs(candidateVictims - factVictims) > 1) {
    return false;
  }

  const candidateDeaths = Number(candidate.deaths);
  const factDeaths = Number(facts.deaths);
  if (Number.isFinite(candidateDeaths) && Number.isFinite(factDeaths) && Math.abs(candidateDeaths - factDeaths) > 1) {
    return false;
  }

  return true;
}

async function extractIncidentFacts(env, url, source) {
  const fallback = heuristicFacts(source);
  if (!env?.AI || !source.text) {
    return fallback;
  }

  const prompt = [
    'Extract incident matching facts from this source.',
    'Return strict JSON only with keys:',
    '{"record_name": string|null, "suspect_name": string|null, "incident_name": string|null, "incident_date": string|null, "year": string|null, "date_basis": "event"|"publication_fallback"|"unknown", "city": string|null, "province": string|null, "victims": number|null, "deaths": number|null, "injuries": number|null, "devices_used": string|null, "firearms": boolean|null, "confidence": number, "reasoning": string}',
    'Rules:',
    '- Use only evidence in the source.',
    '- record_name should be a short display name; prefer the accused/perpetrator surname when known.',
    '- Use Canadian province abbreviations when possible.',
    '- If a value is not clearly stated, return null.',
    '- incident_date is the event/death/incident date, not the article publication date.',
    '- never invent January 1; if only the event year is known, set incident_date to null and year to that event year.',
    '- if the source gives a relative event weekday such as Wednesday and a publication timestamp, resolve it to the matching calendar date.',
    '- year should be the four-digit event/death/incident year when known.',
    '- if only the publication/update year is known, set incident_date to null, year to null, and date_basis to publication_fallback.',
    '- date_basis is event only when incident_date or year came from event/death/incident evidence.',
    '',
    `URL: ${url}`,
    `Title: ${source.title || 'Unknown'}`,
    `Published/updated timestamp if available: ${source.publishedAt || 'Unknown'}`,
    '',
    source.text.slice(0, MAX_AI_TEXT_CHARS)
  ].join('\n');

  const aiJson = await runAiJson(env, prompt, 460);
  if (!aiJson || typeof aiJson !== 'object') {
    return fallback;
  }

  const sourceText = [source.title, source.text].filter(Boolean).join(' ');
  const aiIncidentDate = normalizeIncidentDate(aiJson.incident_date, sourceText);
  const derivedIncidentDate = deriveEventDateFromSource(sourceText, source.publishedAt);
  const incidentDate = aiIncidentDate && sourceSupportsExactDate(aiIncidentDate, sourceText, source.publishedAt)
    ? aiIncidentDate
    : derivedIncidentDate;
  const aiDateBasis = normalizeDateBasis(aiJson.date_basis);
  const pubYear = extractYearOnly(source.publishedAt);
  const rawAiYear = normalizeYear(aiJson.year) || normalizeYear(aiIncidentDate);
  const supportedAiYear = rawAiYear && sourceSupportsEventYear(rawAiYear, sourceText) ? rawAiYear : '';
  const fallbackYear = fallback.date_basis === DATE_BASIS_EVENT ? fallback.year : null;
  const aiYearLooksLikePublicationFallback = (
    rawAiYear &&
    pubYear &&
    rawAiYear === pubYear &&
    !supportedAiYear
  );
  const dateBasis = incidentDate
    ? DATE_BASIS_EVENT
    : supportedAiYear || fallbackYear
      ? DATE_BASIS_EVENT
    : aiYearLooksLikePublicationFallback
      ? DATE_BASIS_PUBLICATION_FALLBACK
      : aiDateBasis;
  const year = incidentDate
    ? normalizeYear(incidentDate)
    : dateBasis === DATE_BASIS_PUBLICATION_FALLBACK
      ? null
      : supportedAiYear || fallbackYear || null;
  const recordName = sourceSupportsName(aiJson.record_name, sourceText) ? nullableString(aiJson.record_name) : null;
  const suspectName = sourceSupportsName(aiJson.suspect_name, sourceText) ? nullableString(aiJson.suspect_name) : null;
  const incidentName = sourceSupportsIncidentName(aiJson.incident_name, sourceText) ? nullableString(aiJson.incident_name) : null;

  return {
    record_name: recordName,
    suspect_name: suspectName,
    incident_name: incidentName,
    incident_date: incidentDate || null,
    year,
    date_basis: dateBasis,
    city: nullableString(aiJson.city),
    province: normalizeProvince(aiJson.province) || null,
    victims: nullableNumber(aiJson.victims),
    deaths: nullableNumber(aiJson.deaths),
    injuries: nullableNumber(aiJson.injuries),
    devices_used: nullableString(aiJson.devices_used),
    firearms: typeof aiJson.firearms === 'boolean' ? aiJson.firearms : null,
    confidence: clamp(Number(aiJson.confidence), 0, 1),
    reasoning: normalizeText(aiJson.reasoning || '').slice(0, MAX_REASON_CHARS)
  };
}

function heuristicFacts(source) {
  const text = normalizeText([source.title, source.text].filter(Boolean).join(' '));
  const textYear = extractYearOnly(text);
  const pubYear = extractYearOnly(source.publishedAt);
  const eventYear = textYear && (textYear !== pubYear || sourceSupportsEventYear(textYear, text)) ? textYear : '';
  const province = extractProvinceCode(text);

  return {
    record_name: null,
    suspect_name: null,
    incident_name: null,
    incident_date: null,
    year: eventYear || null,
    date_basis: eventYear ? DATE_BASIS_EVENT : DATE_BASIS_UNKNOWN,
    city: null,
    province: province || null,
    victims: null,
    deaths: null,
    injuries: null,
    devices_used: null,
    firearms: null,
    confidence: source.text ? 0.25 : 0,
    reasoning: source.text ? 'Heuristic extraction only.' : 'No source text extracted.'
  };
}

async function fetchSourceContent(url) {
  try {
    const fetched = await safeFetchPublicText(url, {
      maxBytes: MAX_SOURCE_FETCH_BYTES,
      headers: {
        'User-Agent': 'MassMurderCanadaBot/1.0 (+https://massmurdercanada.org)',
        'Accept': 'text/markdown, text/html;q=0.9, application/xhtml+xml;q=0.9, text/plain;q=0.8, */*;q=0.7'
      }
    });

    if (!fetched.ok) {
      return makeSource('', '', 'fetch_error', fetched.error || 'Fetch failed');
    }

    const { response, text: raw } = fetched;
    if (!response.ok) {
      return makeSource('', '', 'http_error', `Fetch failed with status ${response.status}`);
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const contentDisposition = (response.headers.get('content-disposition') || '').toLowerCase();
    if (looksLikePdfResponse(url, contentType, contentDisposition)) {
      return makeSource('', '', 'pdf_binary', 'PDF extraction is not supported by ingest proposals yet.');
    }

    if (isLikelyBinaryContentType(contentType)) {
      return makeSource('', '', 'binary_content', `Unsupported content type: ${contentType}`);
    }

    if (contentType.includes('text/markdown') || contentType.includes('text/plain')) {
      const text = normalizeText(cleanMarkdownServiceOutput(raw));
      return makeSource(extractTitleFromText(text), text, 'text');
    }

    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      const text = normalizeText(raw);
      return makeSource(extractTitleFromText(text), text, 'non_html_text');
    }

    return extractSourceFromHtml(raw);
  } catch (error) {
    console.error('Failed to fetch ingest source:', error);
    return makeSource('', '', 'fetch_error', error?.message || 'Fetch failed');
  }
}

function extractSourceFromHtml(html) {
  const jsonLd = extractJsonLdArticle(html);
  const arc = extractArcGlobalContent(html);
  const social = extractSocialStatus(html);
  const meta = extractMeta(html);
  const title = normalizeText(arc.headline || social.headline || jsonLd.headline || meta.title || extractTitleTag(html));
  const publishedAt = normalizeText(arc.publishedAt || social.publishedAt || jsonLd.publishedAt || meta.publishedAt || '');

  const candidates = [
    { text: arc.articleBody, method: 'arc_global_content' },
    { text: normalizeText([arc.headline, arc.description, arc.articleBody].filter(Boolean).join(' ')), method: 'arc_global_combined' },
    { text: social.articleBody, method: 'social_status' },
    { text: jsonLd.articleBody, method: 'jsonld_article_body' },
    { text: normalizeText([jsonLd.headline, jsonLd.description, jsonLd.articleBody].filter(Boolean).join(' ')), method: 'jsonld_combined' },
    { text: extractBlockText(html, 'article'), method: 'article_tag' },
    { text: extractBlockText(html, 'main'), method: 'main_tag' },
    { text: normalizeText([meta.title, meta.description].filter(Boolean).join(' ')), method: 'meta_text' },
    { text: extractTextFromHtml(html), method: 'generic_html_strip' }
  ];

  let best = { text: '', method: 'none', score: 0 };
  for (const candidate of candidates) {
    const text = normalizeText(candidate.text || '');
    const score = scoreExtraction(text, candidate.method);
    if (score > best.score) {
      best = { text, method: candidate.method, score };
    }
  }

  return makeSource(title, best.text, best.method, '', publishedAt);
}

function extractArcGlobalContent(html) {
  const raw = extractAssignedJson(html, 'Fusion.globalContent', ';Fusion.globalContentConfig=');
  const parsed = parseJsonObject(raw);
  if (!parsed || typeof parsed !== 'object') {
    return { headline: '', description: '', articleBody: '', publishedAt: '' };
  }

  const text = collectArticleContentElements(parsed.content_elements || []);
  return {
    headline: normalizeText(parsed.headlines?.basic || parsed.title || ''),
    description: normalizeText(parsed.description?.basic || parsed.subheadlines?.basic || ''),
    articleBody: normalizeText(text),
    publishedAt: normalizeText(
      parsed.first_publish_date ||
      parsed.display_date ||
      parsed.publish_date ||
      parsed.last_updated_date ||
      ''
    )
  };
}

function extractSocialStatus(html) {
  const fullText = decodeJsonStringMatch(html.match(/"full_text"\s*:\s*"((?:\\.|[^"])*)"/));
  if (!fullText) {
    return { headline: '', articleBody: '', publishedAt: '' };
  }

  const createdAt = decodeJsonStringMatch(html.match(/"created_at"\s*:\s*"((?:\\.|[^"])*)"/));
  return {
    headline: normalizeText(extractTitleTag(html)),
    articleBody: fullText,
    publishedAt: normalizeSocialPublishedAt(createdAt)
  };
}

function extractAssignedJson(html, startMarker, endMarker) {
  const start = String(html || '').indexOf(`${startMarker}=`);
  if (start === -1) {
    return '';
  }

  const valueStart = start + startMarker.length + 1;
  const end = String(html || '').indexOf(endMarker, valueStart);
  if (end === -1) {
    return '';
  }

  return String(html || '').slice(valueStart, end).trim();
}

function collectArticleContentElements(elements) {
  const parts = [];
  for (const element of elements || []) {
    if (!element || typeof element !== 'object') {
      continue;
    }

    if (typeof element.content === 'string') {
      parts.push(stripHtmlTags(element.content));
    }

    if (Array.isArray(element.items)) {
      for (const item of element.items) {
        if (typeof item?.content === 'string') {
          parts.push(stripHtmlTags(item.content));
        }
      }
    }
  }

  return normalizeText(parts.join(' '));
}

function makeSource(title, text, method, error = '', publishedAt = '') {
  return {
    title: normalizeText(title || '').slice(0, MAX_TITLE_CHARS),
    text: normalizeText(text || '').slice(0, MAX_EXTRACTED_TEXT_CHARS),
    method,
    error: error || '',
    publishedAt: normalizeText(publishedAt || '')
  };
}

function scoreExtraction(text, method) {
  const normalized = normalizeText(text || '');
  if (!normalized) return 0;

  let score = normalized.length >= 320 ? 2 : 1;
  if (normalized.length >= 1200) score += 1;
  if (method === 'arc_global_content' || method === 'jsonld_article_body' || method === 'social_status') score += 4;
  if (method === 'arc_global_combined') score += 3;
  if (method === 'article_tag') score += 2;
  if (method === 'main_tag' || method === 'jsonld_combined') score += 1;
  if (looksLikeBoilerplate(normalized)) score -= 2;

  return Math.max(0, score);
}

function extractJsonLdArticle(html) {
  const scriptRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const nodes = [];
  let match;

  while ((match = scriptRegex.exec(html)) !== null) {
    const parsed = safeJsonParse((match[1] || '').trim());
    collectJsonLdNodes(parsed, nodes);
  }

  let best = { headline: '', description: '', articleBody: '', publishedAt: '' };
  for (const node of nodes) {
    const type = normalizeText(Array.isArray(node?.['@type']) ? node['@type'].join(' ') : node?.['@type']).toLowerCase();
    const isArticleLike = type.includes('article') || type.includes('newsarticle') || type.includes('report');
    const articleBody = normalizeText(node?.articleBody || '');
    const description = normalizeText(node?.description || '');
    const headline = normalizeText(node?.headline || node?.name || '');
    const publishedAt = normalizeText(node?.datePublished || node?.dateCreated || node?.dateModified || '');

    if (isArticleLike && articleBody.length > best.articleBody.length) {
      best = { headline, description, articleBody, publishedAt };
    } else if (!best.articleBody && normalizeText([headline, description].join(' ')).length > normalizeText([best.headline, best.description].join(' ')).length) {
      best = { headline, description, articleBody, publishedAt };
    }
  }

  return best;
}

function collectJsonLdNodes(input, out) {
  if (!input) return;
  if (Array.isArray(input)) {
    for (const item of input) collectJsonLdNodes(item, out);
    return;
  }
  if (typeof input !== 'object') return;

  out.push(input);
  if (Array.isArray(input['@graph'])) {
    for (const graphNode of input['@graph']) collectJsonLdNodes(graphNode, out);
  }
}

function extractMeta(html) {
  const values = {};
  const metaRegex = /<meta\b[^>]*>/gi;
  let match;

  while ((match = metaRegex.exec(html)) !== null) {
    const attrs = parseHtmlAttributes(match[0]);
    const key = String(attrs.name || attrs.property || '').toLowerCase();
    const content = normalizeText(attrs.content || '');
    if (!key || !content) continue;

    if (key === 'og:title' || key === 'twitter:title') values.title = values.title || content;
    if (key === 'description' || key === 'og:description' || key === 'twitter:description') {
      values.description = values.description || content;
    }
    if (
      key === 'article:published_time' ||
      key === 'article:modified_time' ||
      key === 'datepublished' ||
      key === 'date' ||
      key === 'pubdate'
    ) {
      values.publishedAt = values.publishedAt || content;
    }
  }

  return values;
}

function extractTitleTag(html) {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch?.[1] ? normalizeText(stripHtmlTags(titleMatch[1])) : '';
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
  if (!html) return '';

  const withoutScripts = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ');

  return normalizeText(stripHtmlTags(withoutScripts));
}

function extractTitleFromText(text) {
  const firstLine = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .find(Boolean);
  return normalizeText(firstLine || '').slice(0, MAX_TITLE_CHARS);
}

function cleanMarkdownServiceOutput(text) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const filtered = [];

  for (const rawLine of lines) {
    const line = rawLine.trim().toLowerCase();
    if (
      line.startsWith('title:') ||
      line.startsWith('url source:') ||
      line.startsWith('markdown content:') ||
      line.startsWith('published time:') ||
      line.startsWith('warning:')
    ) {
      continue;
    }
    filtered.push(rawLine);
  }

  return filtered.join('\n');
}

function parseHtmlAttributes(tag) {
  const attrs = {};
  const attrRegex = /([a-zA-Z_:][a-zA-Z0-9_:.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match;

  while ((match = attrRegex.exec(tag)) !== null) {
    const key = match[1]?.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (key) attrs[key] = value;
  }

  return attrs;
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

function looksLikePdfResponse(url, contentType, contentDisposition = '') {
  const lowerType = String(contentType || '').toLowerCase();
  if (lowerType.includes('application/pdf')) return true;

  const lowerDisposition = String(contentDisposition || '').toLowerCase();
  if (lowerDisposition.includes('.pdf')) return true;

  try {
    return new URL(url || '').pathname.toLowerCase().endsWith('.pdf');
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
  if (lower.includes('application/rss+xml')) return false;
  if (lower.includes('application/atom+xml')) return false;

  return (
    lower.includes('application/pdf') ||
    lower.includes('application/octet-stream') ||
    lower.includes('application/zip') ||
    lower.includes('image/') ||
    lower.includes('audio/') ||
    lower.includes('video/') ||
    lower.includes('font/')
  );
}

function looksLikeBoilerplate(text) {
  const lower = String(text || '').toLowerCase();
  const signals = ['cookie', 'privacy policy', 'terms of use', 'all rights reserved', 'subscribe', 'sign in', 'menu'];
  const hits = signals.reduce((count, signal) => count + (lower.includes(signal) ? 1 : 0), 0);
  return hits >= 4 && lower.length < 1800;
}

async function runAiJson(env, prompt, maxTokens = 420) {
  try {
    const model = env.INGEST_AI_MODEL || env.AI_MODEL || DEFAULT_MODEL;
    const result = await env.AI.run(model, {
      messages: [
        {
          role: 'system',
          content: 'You are a strict incident-ingestion assistant. Return valid JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: maxTokens,
      temperature: 0.1
    });

    const text = extractAiText(result);
    return parseJsonObject(text);
  } catch (error) {
    console.error('Ingest AI call failed:', error);
    return null;
  }
}

function extractAiText(result) {
  if (!result) return '';
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

  return '';
}

function parseJsonObject(rawText) {
  if (!rawText) return null;

  const stripped = stripJsonFence(rawText);

  try {
    const parsed = JSON.parse(stripped);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stripJsonFence(rawText) {
  const text = String(rawText || '').trim();
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (match ? match[1] : text).trim();
}

function safeJsonParse(raw) {
  const cleaned = String(raw || '')
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

function decodeJsonStringMatch(match) {
  if (!match?.[1]) {
    return '';
  }

  try {
    return normalizeText(JSON.parse(`"${match[1]}"`));
  } catch {
    return normalizeText(match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n'));
  }
}

function normalizeSocialPublishedAt(value) {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text : parsed.toISOString();
}

function serializeProposalRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    url: row.url,
    normalized_url: row.normalized_url,
    status: row.status,
    proposed_action: row.proposed_action,
    proposed_record_id: row.proposed_record_id,
    proposed_story_id: row.proposed_story_id,
    worker_confidence: row.worker_confidence,
    worker_reason: row.worker_reason,
    agent_decision: row.agent_decision,
    agent_confidence: row.agent_confidence,
    agent_reason: row.agent_reason,
    extracted_title: row.extracted_title,
    extracted_facts: parseJsonObject(row.extracted_facts_json),
    decision: parseJsonObject(row.decision_json),
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    applied_at: row.applied_at,
    applied_story_id: row.applied_story_id
  };
}

function normalizeUrlList(body) {
  if (Array.isArray(body?.urls)) {
    return body.urls.map(url => String(url || '').trim()).filter(Boolean);
  }

  const single = String(body?.url || '').trim();
  return single ? [single] : [];
}

function normalizeStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  const allowed = new Set([
    STATUS_WORKER_PROPOSED,
    STATUS_NEEDS_REVIEW,
    STATUS_DUPLICATE,
    STATUS_APPLIED,
    STATUS_REJECTED
  ]);
  return allowed.has(value) ? value : '';
}

function normalizeRecordId(value) {
  const normalized = String(value || '').trim();
  return isSafeId(normalized) ? normalized : '';
}

function extractRecordIdFromRecordUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const recordIndex = parts.indexOf('records');
    if (recordIndex === -1 || !parts[recordIndex + 1]) {
      return '';
    }
    return normalizeRecordId(parts[recordIndex + 1]);
  } catch {
    return '';
  }
}

function isSafeId(id) {
  return /^[a-zA-Z0-9_-]+$/.test(String(id || '').replace(/-/g, ''));
}

function createProposalId() {
  return `ingest_${createUuid()}`;
}

function createStoryId() {
  return `story_${createUuid()}`;
}

function createUuid() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

function extractYearOnly(rawDate) {
  const text = String(rawDate ?? '').trim();
  if (!text) return '';

  const match = text.match(/\b(1[5-9]\d{2}|20\d{2}|2100)\b/);
  return match ? match[1] : '';
}

function normalizeYear(value) {
  return extractYearOnly(value);
}

function normalizeRecordDate(value) {
  const info = parseDateText(value);
  if (info.exact) {
    return info.exact;
  }
  return info.year || '';
}

function normalizeIncidentDate(value, sourceText = '') {
  const info = parseDateText(value);
  if (!info.exact) {
    return '';
  }
  if (looksLikeSyntheticJanOne(info.exact, sourceText)) {
    return '';
  }
  return info.exact;
}

function parseIncidentDateInfo(facts, sourceText = '') {
  const incident = parseDateText(facts?.incident_date);
  if (incident.year || incident.exact) {
    if (incident.exact && looksLikeSyntheticJanOne(incident.exact, sourceText)) {
      return {
        year: incident.year,
        exact: null
      };
    }
    return incident;
  }

  if (isPublicationFallbackYear(facts)) {
    return {
      year: '',
      exact: null
    };
  }

  return {
    year: normalizeYear(facts?.year),
    exact: null
  };
}

function parseRecordDateInfo(value) {
  const info = parseDateText(value);
  if (!info.exact) {
    return info;
  }

  // Legacy imported records commonly use Jan 1 midnight as a year-only placeholder.
  const raw = String(value || '');
  if (info.exact.endsWith('-01-01') && raw.includes('00:00:00')) {
    return {
      year: info.year,
      exact: null
    };
  }

  return info;
}

function looksLikeSyntheticJanOne(exactDate, sourceText = '') {
  if (!String(exactDate || '').endsWith('-01-01')) {
    return false;
  }

  const year = exactDate.slice(0, 4);
  const normalized = normalizeText(sourceText).toLowerCase();
  return !(
    normalized.includes(exactDate) ||
    normalized.includes(`january 1, ${year}`) ||
    normalized.includes(`january 1 ${year}`) ||
    normalized.includes(`jan. 1, ${year}`) ||
    normalized.includes(`jan 1, ${year}`) ||
    normalized.includes(`01/01/${year}`) ||
    normalized.includes(`1/1/${year}`)
  );
}

function sourceSupportsExactDate(exactDate, sourceText = '', publishedAt = '') {
  if (!exactDate || !isValidIsoDate(exactDate)) {
    return false;
  }

  if (sourceMentionsExactDate(exactDate, sourceText)) {
    return true;
  }

  return deriveEventDateFromSource(sourceText, publishedAt) === exactDate;
}

function sourceMentionsExactDate(exactDate, sourceText = '') {
  const normalized = normalizeText(sourceText).toLowerCase();
  if (!normalized) {
    return false;
  }

  const year = exactDate.slice(0, 4);
  const month = Number(exactDate.slice(5, 7));
  const day = Number(exactDate.slice(8, 10));
  const monthName = monthNameForNumber(month);
  const shortMonth = monthName.slice(0, 3);

  return (
    normalized.includes(exactDate) ||
    normalized.includes(`${monthName} ${day}, ${year}`) ||
    normalized.includes(`${monthName} ${day} ${year}`) ||
    normalized.includes(`${shortMonth}. ${day}, ${year}`) ||
    normalized.includes(`${shortMonth} ${day}, ${year}`) ||
    normalized.includes(`${month}/${day}/${year}`) ||
    normalized.includes(`${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`)
  );
}

function deriveEventDateFromSource(sourceText = '', publishedAt = '') {
  const baseDate = dateOnlyFromTimestamp(publishedAt);
  if (!baseDate) {
    return '';
  }

  const text = normalizeText(sourceText).toLowerCase();
  if (!text) {
    return '';
  }

  const directWeekday = findEventWeekday(text);
  if (directWeekday) {
    return resolveWeekdayDate(baseDate, directWeekday);
  }

  const foundDate = findExactDateNearEvent(text);
  return foundDate || '';
}

function findEventWeekday(text) {
  const weekdayPattern = '(sunday|monday|tuesday|wednesday|thursday|friday|saturday)';
  const directPatterns = [
    new RegExp(`\\b(?:killed|murdered|slain)\\b[^.!?]{0,80}\\b(?:on\\s+)?${weekdayPattern}\\b`, 'i'),
    new RegExp(`\\b${weekdayPattern}\\b[^.!?]{0,80}\\b(?:killed|murdered|slain)\\b`, 'i')
  ];

  for (const pattern of directPatterns) {
    const match = text.match(pattern);
    if (match && !looksLikeChargeDateClause(match[0])) {
      return match[1] || match[2] || '';
    }
  }

  const contextPatterns = [
    new RegExp(`\\bpicked up\\b[\\s\\S]{0,260}\\b${weekdayPattern}\\b[\\s\\S]{0,1000}\\bkilled just before midnight\\b`, 'i'),
    new RegExp(`\\b${weekdayPattern}\\s+night\\b[\\s\\S]{0,360}\\b(?:missing|didn.?t return|did not return)\\b[\\s\\S]{0,1000}\\bkilled just before midnight\\b`, 'i'),
    new RegExp(`\\b${weekdayPattern}\\b[\\s\\S]{0,1200}\\bchildren were killed just before midnight\\b`, 'i'),
    new RegExp(`\\b(?:murdered|killed)\\b[\\s\\S]{0,120}\\bshortly before midnight\\s+${weekdayPattern}\\b`, 'i')
  ];

  for (const pattern of contextPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1] || '';
    }
  }

  return '';
}

function looksLikeChargeDateClause(text) {
  return /\b(?:charge|charges|charged|laid)\b[^.!?]{0,40}\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(text);
}

function findExactDateNearEvent(text) {
  const monthPattern = '(january|jan\\.?|february|feb\\.?|march|mar\\.?|april|apr\\.?|may|june|jun\\.?|july|jul\\.?|august|aug\\.?|september|sep\\.?|sept\\.?|october|oct\\.?|november|nov\\.?|december|dec\\.?)';
  const pattern = new RegExp(`\\b(?:killed|murdered|dead|deaths|found)\\b[^.!?]{0,120}\\b${monthPattern}\\s+([0-3]?\\d)(?:st|nd|rd|th)?,?\\s+(1[5-9]\\d{2}|20\\d{2}|2100)\\b`, 'i');
  const match = text.match(pattern);
  if (!match) {
    return '';
  }

  return buildIsoDate(match[3], monthNumberFromName(match[1]), match[2]);
}

function normalizeDateBasis(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['event', 'event_date', 'event_year', 'incident', 'incident_date', 'incident_year'].includes(normalized)) {
    return DATE_BASIS_EVENT;
  }
  if (normalized === DATE_BASIS_PUBLICATION_FALLBACK || normalized === 'publication' || normalized === 'published') {
    return DATE_BASIS_PUBLICATION_FALLBACK;
  }
  return DATE_BASIS_UNKNOWN;
}

function isPublicationFallbackYear(facts) {
  return normalizeDateBasis(facts?.date_basis) === DATE_BASIS_PUBLICATION_FALLBACK;
}

function sourceSupportsEventYear(year, sourceText = '') {
  const normalizedYear = normalizeYear(year);
  if (!normalizedYear) {
    return false;
  }

  const sentences = normalizeText(sourceText)
    .replace(/([.!?])\s+/g, '$1\n')
    .split(/\n+/)
    .map(sentence => sentence.trim().toLowerCase())
    .filter(Boolean);

  return sentences.some(sentence => {
    if (!sentence.includes(normalizedYear)) {
      return false;
    }

    if (/\b(published|updated|modified|posted|copyright|all rights reserved)\b/.test(sentence)) {
      return false;
    }

    return /\b(death|deaths|dead|died|die|killed|murder|murdered|homicide|manslaughter|incident|attack|shooting|shot|stabbed|stabbing|fire|found)\b/.test(sentence);
  });
}

function parseDateText(value) {
  const text = String(value || '').trim();
  if (!text) {
    return { year: '', exact: null };
  }

  const isoMatch = text.match(/\b(1[5-9]\d{2}|20\d{2}|2100)-([01]\d)-([0-3]\d)\b/);
  if (isoMatch) {
    const exact = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    if (isValidIsoDate(exact)) {
      return {
        year: isoMatch[1],
        exact
      };
    }
  }

  const monthMatch = text.match(/\b(january|jan\.?|february|feb\.?|march|mar\.?|april|apr\.?|may|june|jun\.?|july|jul\.?|august|aug\.?|september|sep\.?|sept\.?|october|oct\.?|november|nov\.?|december|dec\.?)\s+([0-3]?\d)(?:st|nd|rd|th)?,?\s+(1[5-9]\d{2}|20\d{2}|2100)\b/i);
  if (monthMatch) {
    const exact = buildIsoDate(monthMatch[3], monthNumberFromName(monthMatch[1]), monthMatch[2]);
    if (exact) {
      return {
        year: monthMatch[3],
        exact
      };
    }
  }

  return {
    year: extractYearOnly(text),
    exact: null
  };
}

function buildIsoDate(year, month, day) {
  const exact = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidIsoDate(exact) ? exact : '';
}

function isValidIsoDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateOnlyFromTimestamp(value) {
  const direct = String(value || '').match(/\b(1[5-9]\d{2}|20\d{2}|2100)-([01]\d)-([0-3]\d)\b/);
  if (direct) {
    const exact = `${direct[1]}-${direct[2]}-${direct[3]}`;
    return isValidIsoDate(exact) ? exact : '';
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function resolveWeekdayDate(baseDate, weekdayName) {
  const target = weekdayIndex(weekdayName);
  if (target < 0) {
    return '';
  }

  const date = new Date(`${baseDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const diff = (date.getUTCDay() - target + 7) % 7;
  date.setUTCDate(date.getUTCDate() - diff);
  return date.toISOString().slice(0, 10);
}

function weekdayIndex(name) {
  return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(String(name || '').toLowerCase());
}

function monthNumberFromName(name) {
  const normalized = String(name || '').toLowerCase().replace(/\./g, '');
  const index = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'].indexOf(normalized.slice(0, 4) === 'sept' ? 'sept' : normalized.slice(0, 3));
  if (index === -1) {
    return 0;
  }
  return index >= 9 ? index : index + 1;
}

function monthNameForNumber(month) {
  return [
    '',
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december'
  ][Number(month)] || '';
}

function daysBetween(a, b) {
  const left = new Date(`${a}T00:00:00Z`).getTime();
  const right = new Date(`${b}T00:00:00Z`).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.round((left - right) / 86400000);
}

function extractProvinceCode(text) {
  const upper = String(text || '').toUpperCase();
  const codes = ['BC', 'AB', 'SK', 'MB', 'ON', 'QC', 'NB', 'NS', 'PE', 'NL', 'YT', 'NT', 'NU'];
  return codes.find(code => new RegExp(`\\b${code}\\b`).test(upper)) || '';
}

function isCanadianProvinceCode(value) {
  return ['BC', 'AB', 'SK', 'MB', 'ON', 'QC', 'NB', 'NS', 'PE', 'NL', 'YT', 'NT', 'NU'].includes(String(value || '').toUpperCase());
}

function normalizeProvince(value) {
  const text = String(value || '').trim().toUpperCase();
  const aliases = {
    ALBERTA: 'AB',
    'BRITISH COLUMBIA': 'BC',
    MANITOBA: 'MB',
    'NEW BRUNSWICK': 'NB',
    NEWFOUNDLAND: 'NL',
    'NEWFOUNDLAND AND LABRADOR': 'NL',
    'NOVA SCOTIA': 'NS',
    ONTARIO: 'ON',
    'PRINCE EDWARD ISLAND': 'PE',
    QUEBEC: 'QC',
    SASKATCHEWAN: 'SK',
    YUKON: 'YT',
    'NORTHWEST TERRITORIES': 'NT',
    NUNAVUT: 'NU'
  };

  if (/^[A-Z]{2,3}$/.test(text)) return isCanadianProvinceCode(text) ? text : '';
  return aliases[text] || '';
}

function normalizeComparable(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nullableString(value) {
  const text = normalizeText(value || '');
  return text || null;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableBooleanNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (value === true || value === 1 || value === '1') return 1;
  if (value === false || value === 0 || value === '0') return 0;

  const normalized = String(value).trim().toLowerCase();
  if (['true', 'yes', 'on'].includes(normalized)) return 1;
  if (['false', 'no', 'off'].includes(normalized)) return 0;
  return null;
}

function compactObject(value) {
  const result = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (item !== null && item !== undefined && item !== '') {
      result[key] = item;
    }
  }
  return result;
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return Number.NaN;
  return Math.min(max, Math.max(min, value));
}

function getConfidenceThreshold(env, key, defaultValue) {
  const number = Number(env?.[key]);
  return Number.isFinite(number) ? clamp(number, 0, 1) : defaultValue;
}

function parseIntegerInRange(value, defaultValue, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed)) return defaultValue;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function mergeJson(base, next) {
  if (!base || typeof base !== 'object') {
    return next || null;
  }
  if (!next || typeof next !== 'object') {
    return base;
  }
  return { ...base, ...next };
}

async function readJsonBodySafe(request) {
  try {
    const raw = await request.text();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function isUniqueConstraintError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('unique constraint') || message.includes('constraint failed') || message.includes('unique');
}

function isMissingIngestSchemaError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('no such table: story_ingest_proposals') ||
    message.includes('no such column: ns.canonical_url') ||
    message.includes('no such column: canonical_url')
  );
}

export const __test = {
  buildUrlLookupVariants,
  candidateHardFieldsCompatible,
  deriveEventDateFromSource,
  extractSourceFromHtml,
  normalizeIncidentDate,
  parseJsonObject,
  parseRecordSearchParams,
  scoreRecordCandidate,
  searchRecordCandidates,
  sourceSupportsName
};
