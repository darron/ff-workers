# Pre-Public Release Review — Agent-Assisted Story Ingestion

> Audience: maintainers reviewing commit `91584ae` (`feat(ingest): add agent-assisted story proposal flow`) and the broader codebase before publishing the repo.
>
> Scope: security and correctness, with operational hygiene as a secondary concern.
>
> Status: findings only. No code has been changed yet. Each finding has a suggested remediation; pick what to apply, defer, or accept.

## TL;DR

Treat these four as **release blockers** before going public:

1. **SSRF via DNS resolution and follow-redirects** in the new ingest fetcher and the pre-existing summary fetcher.
2. **Missing DB-level URL uniqueness / atomic dedupe** for `news_stories` and `story_ingest_proposals`.
3. **Overly permissive agent record overrides** in the create-record approval path.
4. **No fetch timeouts, response-size caps, or rate limits** on the bearer-token endpoints.

No exploitable SQL injection found. Bearer-token routing is correctly scoped to `/admin/api/ingest/*`. No current stored-XSS sink for the new ingest fields.

The rest of the items below (#5–#10) are worth cleaning up but are not in the same class.

---

## 1. (High) Ingest fetch is SSRF-exposed via DNS and redirects

**Affected**
- [src/ingest.js#L1619-L1658](file:///Users/darron/src/ff-workers/src/ingest.js#L1619-L1658) — `fetchSourceContent`
- [src/url-safety.js#L5-L93](file:///Users/darron/src/ff-workers/src/url-safety.js#L5-L93) — `validateAndNormalizePublicHttpUrl`, `isBlockedHostname`, `isPrivateOrLocalIp`

**Problem**
The validator only rejects literal local/private hostname or IP strings. It does not protect against:

- public hostnames that resolve to private/internal IPs
- CNAME chains or DNS rebinding
- `redirect: 'follow'` jumping from an allowed public URL to a private target
- non-default ports

`fetch(url, { redirect: 'follow' })` then transparently chases redirects without re-running validation on the new `Location`.

Do not assume Workers' `fetch` blocks this. Some Cloudflare configurations let Workers reach private origins, and SSRF-via-redirect has been a recurring class issue across platforms. The Worker should enforce this itself.

**Suggested remediation**
- Switch all ingest fetches to `redirect: 'manual'` and follow hops yourself, re-running URL validation on each `Location`.
- Cap the redirect chain (e.g. 3 hops) and reject non-HTTP(S) schemes mid-chain.
- Reject non-standard ports unless explicitly needed.
- Optionally, gate ingest behind a hostname allowlist of trusted Canadian/news/government domains as a launch-time conservative default. Open it up later.
- If you ever need fully open-domain ingest, route the fetch through a dedicated, network-isolated extractor service rather than relying on JS-only hostname checks.

---

## 2. (High) URL dedupe is not atomic — duplicate stories can race in

**Affected**
- [src/ingest.js#L279-L302](file:///Users/darron/src/ff-workers/src/ingest.js#L279-L302), [src/ingest.js#L350-L384](file:///Users/darron/src/ff-workers/src/ingest.js#L350-L384), [src/ingest.js#L395-L408](file:///Users/darron/src/ff-workers/src/ingest.js#L395-L408)
- [src/ingest.js#L978-L1001](file:///Users/darron/src/ff-workers/src/ingest.js#L978-L1001) — `findExistingStoryByUrl`
- [migrations/0004_ingest_proposals.sql](file:///Users/darron/src/ff-workers/migrations/0004_ingest_proposals.sql)
- existing `news_stories` schema

**Problem**
- Dedupe is a check-then-insert in application code with no DB constraint behind it.
- `news_stories.url` has no `UNIQUE` index. Two concurrent approvals can both pass the check and both insert.
- `story_ingest_proposals.normalized_url` has no uniqueness on active statuses. The same URL can accumulate many parallel pending proposals.
- A bearer-token holder can intentionally race approvals or rapidly resubmit slight URL variants.

**Suggested remediation**
- Add a canonical-URL column to `news_stories` (or canonicalize on write) and put a `UNIQUE` index on it.
- On approval, use conflict-aware insertion (`INSERT OR IGNORE` and check rowcount, or trap the unique-violation error) and mark the proposal `duplicate` if the insert lost the race.
- For proposals, either add a partial unique index on `(normalized_url, status)` for active statuses, or look up an existing active proposal by canonical URL before inserting a new one.
- Backfill old `news_stories.url` rows to the canonical form once before adding the unique index.

---

## 3. (High) Create-record approvals let the agent override too much canonical data

**Affected**
- [src/ingest.js#L373-L380](file:///Users/darron/src/ff-workers/src/ingest.js#L373-L380) — `approveCreateRecordProposal` calling `buildRecordForCreate`
- [src/ingest.js#L702-L759](file:///Users/darron/src/ff-workers/src/ingest.js#L702-L759) — `buildRecordForCreate`
- [src/ingest.js#L761-L789](file:///Users/darron/src/ff-workers/src/ingest.js#L761-L789) — `pickRecordOverrides`
- [src/ingest.js#L2557-L2578](file:///Users/darron/src/ff-workers/src/ingest.js#L2557-L2578) — `normalizeProvince`

**Problem**
The "Worker re-validates" promise is mostly structural for `create_record`:

- record id is well-formed
- date parses
- city/province present
- 2+ victims or deaths
- confidence threshold met

But the approver-supplied `record` object can override `date`, `name`, `city`, `province`, `victims`, `deaths`, `injuries`, `licensed`, `suicide`, `devices_used`, `firearms`, `possessed_legally`, `warnings`, `oic_impact` with no requirement that they match the worker proposal or the extracted source facts. `normalizeProvince` accepts any 2–3 uppercase letters, so junk province codes can land too.

A token-holder (or compromised agent) can therefore mint records with attacker-chosen canonical metadata while pointing at any URL the worker happened to accept.

**Suggested remediation**
Pick one:

- **Strict (recommended for launch):** drop `body.record` overrides entirely from bearer-token approvals. Approvals carry only `record_id`, `agent_confidence`, `agent_reason`. Field corrections go through a future human-reviewed `record_patch` flow (already mentioned in `AGENTS.md`).
- **Relaxed:** allow at most a small whitelist (e.g. `name` only) and require exact match against the worker-proposed `city`, `province`, `victims`, `deaths`, and `date`. Validate province with `isCanadianProvinceCode()` in the create-record path.

---

## 4. (Medium) No fetch timeouts, no body-size cap, no rate limit

**Affected**
- [src/ingest.js#L97-L120](file:///Users/darron/src/ff-workers/src/ingest.js#L97-L120) — `createProposals` (sequential `await` over up to 20 URLs)
- [src/ingest.js#L1619-L1658](file:///Users/darron/src/ff-workers/src/ingest.js#L1619-L1658) — `fetchSourceContent` (`await response.text()` with no cap)
- existing `src/ai-summary.js` summary fetch path has the same shape

**Problem**
Worker fetches on attacker-controlled URLs with:

- no `AbortSignal.timeout(...)`
- no `Content-Length` cap
- no streaming size limit
- up to 20 URLs per request, processed sequentially
- plus an AI call and DB writes per URL

A slow or huge response can burn the Worker's CPU/wall-time budget, and there is no rate limiting on the bearer-token endpoint.

**Suggested remediation**
- Add `signal: AbortSignal.timeout(15_000)` (or similar) to all outbound fetches.
- Reject obviously-large bodies via `Content-Length` if present, then stream up to a hard cap (e.g. 1–2 MB) using `response.body.getReader()` and abort if exceeded.
- Reduce `MAX_BATCH_URLS` from 20 to something like 1–5 for launch.
- Put a Cloudflare WAF / rate-limit rule on `/admin/api/ingest/*` (per-IP or per-token).

Apply the same fixes to `src/ai-summary.js` once #6 is addressed.

---

## 5. (Medium) URL canonicalization is too weak — same article dedupes inconsistently

**Affected**
- [src/url-safety.js#L5-L31](file:///Users/darron/src/ff-workers/src/url-safety.js#L5-L31) — `validateAndNormalizePublicHttpUrl`
- [src/ingest.js#L978-L1001](file:///Users/darron/src/ff-workers/src/ingest.js#L978-L1001) — `findExistingStoryByUrl`

**Problem**
Current normalization mostly lowercases the hostname and strips a trailing dot. It does not:

- strip the fragment (`#...`)
- drop default ports (`:80`, `:443`)
- normalize empty path to `/`
- strip tracking params (`utm_*`, `fbclid`, `gclid`, etc.)
- canonicalize trailing-slash differences

`findExistingStoryByUrl` then compares against `news_stories.url` as-is, so older manually-created rows that were stored non-canonically remain dedupe blind spots.

**Suggested remediation**
- In `validateAndNormalizePublicHttpUrl`:
  - `parsed.hash = ''`
  - drop default ports
  - normalize empty path to `/`
  - strip a configured list of tracking params
- Persist the canonical form on `news_stories`.
- Backfill existing rows once before adding the `UNIQUE` index from #2.

---

## 6. (Medium) Pre-existing summary pipeline duplicates URL safety and leaks URLs to third-party extractors

**Affected**
- [src/ai-summary.js#L640-L678](file:///Users/darron/src/ff-workers/src/ai-summary.js#L640-L678) — `getSafePublicHttpUrl` (a near-duplicate of `url-safety.js`)
- `src/ai-summary.js` Jina / Markdown.new / summarize-daemon fallbacks
- [wrangler.toml#L29-L31](file:///Users/darron/src/ff-workers/wrangler.toml#L29-L31), [wrangler.toml#L92-L94](file:///Users/darron/src/ff-workers/wrangler.toml#L92-L94) (`AI_FETCH_JINA_FALLBACK = "true"`, `AI_FETCH_MARKDOWN_NEW_FALLBACK = "true"`)

**Problem**
- `ai-summary.js` re-implements the same hostname checks instead of importing the shared `src/url-safety.js`. Two copies will drift.
- It also uses `redirect: 'follow'` (same SSRF gap as #1).
- Production and staging both default to enabling Jina (`r.jina.ai`) and Markdown.new fallbacks, meaning story URLs (and possibly extracted content) can be sent to third-party services. For a public-interest project this should be an explicit, documented decision rather than a default.

**Suggested remediation**
- Refactor to a single shared `safeFetchPublic(url, opts)` helper that owns: validation, manual redirect handling, timeout, size cap.
- Use it in both `ingest.js` and `ai-summary.js`.
- Default `AI_FETCH_JINA_FALLBACK=false` and `AI_FETCH_MARKDOWN_NEW_FALLBACK=false`.
- Document in `docs/SECURITY.md` and `docs/INGESTION.md` exactly when (if ever) URLs or article text leave Cloudflare.

---

## 7. (Medium) `parseJsonObject` is too forgiving and can misparse model output

**Affected**
- [src/ingest.js#L2049-L2071](file:///Users/darron/src/ff-workers/src/ingest.js#L2049-L2071) — `parseJsonObject`

**Problem**
On failed strict parse, the helper greedy-matches `\{[\s\S]*\}` and parses the first chunk it finds. That can silently turn malformed LLM output into the wrong object, which then drives:

- fact extraction
- candidate selection
- proposal decisions
- audit data stored in `decision_json`

Correctness in this feature is safety-critical (records of real incidents).

**Suggested remediation**
- Drop the greedy regex fallback. Accept only valid JSON (optionally with a fenced ```json``` block stripped first).
- After parsing, validate against an explicit schema: required keys, types, ranges, enums.
- On parse or schema failure, mark the proposal `needs_review` with an explanatory `error`, don't best-effort.

---

## 8. (Low) Caught errors in the admin/ingest API don't auto-report to Sentry

**Affected**
- [src/index.js#L146-L153](file:///Users/darron/src/ff-workers/src/index.js#L146-L153) — `Sentry.withSentry(..., workerHandler)`
- [src/ingest.js#L85-L94](file:///Users/darron/src/ff-workers/src/ingest.js#L85-L94) — top-level catch returning 500
- [src/admin.js](file:///Users/darron/src/ff-workers/src/admin.js) — similar caught-and-converted-to-500 patterns

**Problem**
`Sentry.withSentry` captures uncaught exceptions, but these handlers catch errors and return a generic 500 after `console.error`. Those errors won't reach Sentry automatically. Meanwhile `sendDefaultPii: true` is enabled, which is probably broader than needed.

**Suggested remediation**
- In those `catch` blocks, call `Sentry.captureException(error, { tags: { area: 'ingest' } })` before returning the 500.
- Set `sendDefaultPii: false` unless you have a specific reason to enable it.
- Scrub `Authorization` and `Cookie` headers if you ever attach the raw request to Sentry events.

---

## 9. (Low) Admin UI has `target="_blank"` without `rel="noopener noreferrer"`

**Affected**
- [src/admin-ui.js#L427](file:///Users/darron/src/ff-workers/src/admin-ui.js#L427)
- [src/admin-ui.js#L620](file:///Users/darron/src/ff-workers/src/admin-ui.js#L620)

**Problem**
Classic reverse-tabnabbing exposure. `src/templates.js` already does this correctly; admin UI doesn't.

**Suggested remediation**
Add `rel="noopener noreferrer"` to both anchors. Trivial fix.

---

## 10. (Low) Local token-rotation task has a small file-permission race

**Affected**
- [Taskfile.yml](file:///Users/darron/src/ff-workers/Taskfile.yml) — `staging:secret:rotate-ingest-token`

**Problem**
The task does `: > "$FILE" && chmod 600 "$FILE" && printf "$token" > "$FILE"`. There's a brief window where the freshly-truncated file exists with the user's default umask permissions before `chmod 600` runs. On a single-user Mac the risk is low.

**Suggested remediation**
Write to a `mktemp` file under a `umask 077` shell, then `mv` atomically into place:

```sh
umask 077 && tmp=$(mktemp) && \
  printf '%s' "$token" > "$tmp" && \
  mv "$tmp" "$STAGING_INGEST_TOKEN_FILE"
```

Storing the token under `/private/tmp` is otherwise reasonable for local operator tooling. The path is already gitignored implicitly (outside the repo).

---

## Confirmed non-issues / not blocking

- **SQL injection:** All app queries use `.bind()` parameters. The dynamic `UPDATE ... SET` in `src/admin.js` interpolates only hardcoded column names, not user input. The `Taskfile.yml` operator task that interpolates `RECORD_ID` into raw SQL pre-validates it as a UUID via a `preconditions` regex; acceptable.
- **Bearer-token scoping:** `src/admin.js` only short-circuits to bearer auth when `isIngestAPIPath(segments)` is true; everything else still requires session auth. `src/index.js` only fast-paths `/admin/api/ingest/`. No path-based bypass to generic admin APIs found.
- **Stored XSS for the new fields:** `extracted_title`, `extracted_text`, `worker_reason`, `agent_reason` are not currently rendered in any HTML page. Admin UI and public templates escape what they do render. This is a latent risk if you later build a proposal-review UI; keep using `escapeHtml`.
- **`isSafeId`:** Unusual shape (strips dashes, then matches), but functionally correct for UUID-like IDs and bound DB params. Not a bug.
- **`story_ingest_proposals` has no foreign keys:** Acceptable for an audit/proposal table where some referenced IDs are hypothetical at proposal time.
- **1000- and 2000-row record scans** in `findCandidateRecords` and `searchRecords` aren't ideal long-term but aren't a publication blocker at the current dataset size. Revisit once records are in the several-thousand range.
- **`generate-password-hash.js`, `database_dump.sql`** — checked, contain no live secrets. Dump is records data only.

---

## Suggested order of operations

1. Fix #1 (SSRF) and #4 (timeouts/size caps) together — they touch the same fetch path.
2. Apply #3 (lock down create-record overrides) — single-file, fast, removes the worst trust-model gap.
3. Add the URL canonicalization in #5 and the `UNIQUE` index + atomic insert in #2 in one migration + code change.
4. Refactor #6 (single shared safe-fetch helper) so #1 and #4 don't have to be re-applied to `ai-summary.js`.
5. Tighten #7 (strict JSON parsing) and #8 (Sentry capture).
6. Sweep #9 and #10.
7. Re-run `npm test`, `node --check src/ingest.js`, `git diff --check`, then re-run an end-to-end staging ingest smoke test before publishing.

---

## Open questions for the maintainer

- Are you comfortable launching with a **hostname allowlist** for ingest, or do you want open-domain ingest from day one? This decision drives how aggressive the SSRF mitigations need to be.
- Do you actually want third-party extractor fallbacks (Jina / Markdown.new) enabled in production? If yes, this should be called out in `docs/SECURITY.md`.
- Are agent-supplied record overrides on `create_record` approvals a feature you want to keep, or were they only for testing? The default in this review is to remove them.
