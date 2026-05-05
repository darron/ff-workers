---
name: massmurdercanada-story-ingest
description: Use when adding article/source URLs to Mass Murder Canada through the agent-assisted ingestion API. Guides a remote agent to create Worker proposals, independently approve or reject proposed record matches, and avoid direct story writes unless explicitly instructed by the human operator.
---

# Mass Murder Canada Story Ingest

Use this skill when the user asks you to add, ingest, attach, classify, or review source URLs for Mass Murder Canada records.

## Required Inputs

- Site base URL, usually `https://massmurdercanada.org`
- `INGEST_API_TOKEN`
- One or more source URLs

Use bearer auth:

```http
Authorization: Bearer <INGEST_API_TOKEN>
```

## Core Rule

Do not write directly to `/admin/api/stories` for normal ingestion.

Always use the proposal flow:

1. Submit URL to create a Worker proposal.
2. Review the Worker proposal independently.
3. Approve only when you agree with the proposed record.
4. Reject clear mismatches.
5. Leave uncertain cases in `needs_review`.

## Create Proposal

```bash
curl -s "$MMC_BASE_URL/admin/api/ingest/proposals" \
  -H "Authorization: Bearer $INGEST_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/article"}'
```

Batch submissions are allowed:

```json
{
  "urls": [
    "https://example.com/article-1",
    "https://example.com/article-2"
  ]
}
```

Maximum batch size is 5.

## Review Proposal

Inspect:

- `status`
- `proposed_action`
- `proposed_record_id`
- `worker_confidence`
- `worker_reason`
- `extracted_facts`
- `decision.top_candidates`
- `decision.proposed_record` when `proposed_action` is `create_record`
- `decision.record_date_basis` for new-record date provenance

Approve only `worker_proposed` proposals.

## Search Existing Records

Use read-only search when the Worker proposes `create_record`, when candidate evidence is thin, or when you need to verify whether a nearby existing incident already exists.

```bash
curl -s "$MMC_BASE_URL/admin/api/ingest/records/search?city=Calgary&province=AB&date=2026-04-29&victims=2&deaths=2" \
  -H "Authorization: Bearer $INGEST_API_TOKEN"
```

Useful parameters:

- `q`
- `city`
- `province`
- `year`
- `date`
- `date_window_days`
- `victims`
- `deaths`
- `injuries`
- `limit`

Search results are advisory only. Do not use search as a write path; approval still goes through the proposal endpoint.

## Metadata Updates

New stories may reveal canonical record facts after an incident is first added, such as a suspect or accused person's name replacing `Unknown`.

Do not update record fields silently. In the current API, attach the story through ingestion and report the possible metadata update back to the human operator with the exact source evidence. Treat this as a future `record_patch` proposal workflow, not as part of normal story approval.

Do not approve:

- `needs_review`
- `duplicate`
- `rejected`
- proposals where the Worker record does not match your independent judgment
- proposals below confidence threshold
- proposals with insufficient source evidence

## Independent Match Criteria

A URL belongs to an existing record only when the source and record describe the same incident.

Prefer hard evidence:

- same incident/person/family/common case name
- same or nearby event/death/incident date
- same city or municipality
- same province
- same year
- same or compatible victim/death/injury counts
- same weapon/device details
- source text clearly discusses the incident, not a related policy article or different case

Treat record dates as year-only metadata unless source text gives exact dates.
Do not treat article publication/update dates as event dates. If `decision.record_date_basis` is `publication_fallback`, mention that in your report back and use extra caution before approving a newly created record.

If a source has a clear event date and no existing record is near that date, expect a `create_record` proposal. If an existing record is around the same date and has compatible facts, it may be the right attachment target even when the title or extracted name differs.

Social-only sources should be treated as alleged unless corroborated by independent reporting.

## Approve

Use the Worker-proposed record ID when it is correct. If the Worker proposes `create_record` but you find a clearly matching existing record, you may approve with the existing record ID instead. This is an agent redirect: use it only with high confidence and a concrete evidence-based `agent_reason`.

If your target differs from a Worker `attach_to_record` proposal, do not approve; leave it for review.

For `proposed_action: "attach_to_record"`, the ID must already exist.

For `proposed_action: "create_record"`, the ID is the new record UUID the Worker will create if approved. Review `decision.proposed_record` carefully before approving.

```bash
curl -s "$MMC_BASE_URL/admin/api/ingest/proposals/$PROPOSAL_ID/approve" \
  -H "Authorization: Bearer $INGEST_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "record_id": "record-uuid",
    "agent_confidence": 0.92,
    "agent_reason": "Article names the same incident, city, year, and victim count."
  }'
```

Approval should include:

- `record_id`
- `agent_confidence`, 0 to 1
- `agent_reason`, one concise evidence-based sentence

For `create_record`, do not send `record` field overrides. Approve the Worker-proposed record ID only when the proposed record is correct enough to create as-is. Report field corrections separately for human/admin review.

For `create_record` proposals that are actually duplicates of an existing incident, approve with the existing record ID instead of rejecting. Example reason: "Article is about the sole survivor of the existing Felix shooting later dying from injuries, not a separate incident."

```json
{
  "record_id": "worker-proposed-record-uuid",
  "agent_confidence": 0.92,
  "agent_reason": "The source describes a new Calgary incident with two child deaths."
}
```

## Reject

Reject only clear mismatches.

```bash
curl -s "$MMC_BASE_URL/admin/api/ingest/proposals/$PROPOSAL_ID/reject" \
  -H "Authorization: Bearer $INGEST_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_confidence": 0.9,
    "agent_reason": "The article describes a different incident."
  }'
```

## Review Existing Proposal

```bash
curl -s "$MMC_BASE_URL/admin/api/ingest/proposals/$PROPOSAL_ID" \
  -H "Authorization: Bearer $INGEST_API_TOKEN"
```

List proposals requiring human review:

```bash
curl -s "$MMC_BASE_URL/admin/api/ingest/proposals?status=needs_review&limit=25" \
  -H "Authorization: Bearer $INGEST_API_TOKEN"
```

## Report Back

Summarize each URL with:

- proposal ID
- final status
- proposed/applied record ID
- confidence values
- one-line reason

If anything needs review, say exactly why.
