> Current provider decision: Gemini only. The original provider examples below are historical. Use README.md and .env.example for the implemented configuration.

# Freedom Broker CQA architecture

## Purpose and boundaries

This is an implementation blueprint for the 24-hour prototype specified in `TASK.md`, not a production contact-center platform. Use one Next.js TypeScript application on Vercel, Supabase Postgres and private Storage, and OpenAI server-side. The required product includes chats, actual call-audio assessment, editable criteria, traceable evidence and human appeals. Keep business logic independent of UI and hosting so the presentation layer can later be adapted to a Dynamics 365 HTML component.

The guide is authoritative for requirements. The official eight-criterion checklist is still missing. All scoring defaults below are EXAMPLES for testing an engine, not official grading rules. Import the real policy through the editor and add exact golden tests before declaring official compliance.

## Components and data flow

```text
Browser: React workspace, checklist editor, transcript, audio player, appeals
    |
    | same-origin JSON requests; no provider or database secret keys
    v
Next.js Node route handlers on Vercel
    |-- validation, demo access boundary, rate limits, SSRF protection
    |-- import adapter --> organizer GET API (endpoint + group_id)
    |-- evaluator orchestrator --> OpenAI text / audio adapters
    |-- pure scoring engine + evidence validator
    |-- repository layer --> Supabase Postgres
    |-- short-lived authorized playback/upload --> private Supabase Storage
    v
Persisted jobs, immutable evaluation history, usage ledger and audit trail
```

No Redis, vector database, custom training, separate Python API or mandatory paid queue is necessary for the initial build. Do not introduce a long-running server process into Vercel Functions. All provider access stays on the server. Audio input bytes are never passed through a large browser-to-Next JSON body.

### Proposed project structure

```text
app/
  page.tsx                         # dialogue workspace
  checklists/page.tsx
  appeals/page.tsx
  runs/page.tsx
  api/import/route.ts
  api/conversations/...
  api/checklists/...
  api/evaluations/...
  api/jobs/[id]/step/route.ts
  api/appeals/...
  api/audio/...
components/
  workspace/ transcript/ evaluation/ checklist/ appeals/ audio/ common/
lib/
  contracts/                       # shared Zod types; no server secrets
  domain/scoring.ts                # pure deterministic arithmetic
  domain/evidence.ts               # source-reference validation
  domain/policy.ts                 # safe policy validation
  server/env.ts                    # server-only; validate on startup
  server/db.ts                     # Supabase privileged access; server-only
  server/importer.ts
  server/jobs.ts
  server/budget.ts
  server/security.ts
  server/ai/text.ts
  server/ai/audio.ts
  server/ai/prompts.ts
  server/ai/contracts.ts
supabase/migrations/
scripts/                           # safe synthetic seed and optional audio preparation
fixtures/synthetic/                # no real DEV records or recordings
tests/unit/ tests/integration/ tests/e2e/
README.md
.env.example
```

Keep domain contracts in ordinary TypeScript and exported JSON schemas. React components call a small API client instead of Supabase directly. Avoid coupling scoring to route handlers or UI labels. No arbitrary runtime code evaluation for checklist formulas.

## Data model

Use UUID primary keys, UTC database timestamps, explicit foreign keys, CHECK constraints, and JSONB only where the object is naturally versioned. Store original supplied timestamps as TEXT separately from parsed timestamps. All mutable resources have a revision for optimistic concurrency. The tables below describe required behavior; migrations may refine names without changing invariants.

### Imports and conversations

- `dataset_imports`: id, group_id, source_label, status, started_at, finished_at, expected_count, imported_count, error_summary. Do not persist secret URL query values in logs.
- `conversations`: id, group_id, source_conversation_id, current_version_id. Unique `(group_id, source_conversation_id)`.
- `conversation_versions`: id, conversation_id, content_sha256, channel, language, source_audio_reference (private), raw_payload, created_at. Unique `(conversation_id, content_sha256)`; never mutate a version used in an evaluation.
- `messages`: id, conversation_version_id, ordinal, source_timestamp, parsed_timestamp nullable, speaker, text. Unique `(conversation_version_id, ordinal)`. Keep raw roles and reject unsupported shapes rather than silently deleting context.
- `audio_assets`: id, conversation_version_id, private_storage_path nullable, mime_type, byte_size, duration_seconds, content_sha256, status, alignment_status, recording_start_timestamp nullable, alignment_method, created_at. Keep the original upstream URL server-only; do not make real audio public.
- `audio_segments`: id, audio_asset_id, start_seconds, end_seconds, speaker_attribution, attribution_status, preparation_method. Offsets are relative to the original recording, not reset for each chunk.

When reimported data changes, add a version and update the current pointer transactionally. Old evidence always references the exact evaluated version. Original text must remain recoverable; normalized search text must not replace it.

### Checklist versions

- `checklists`: id, name, current_version_id, revision, created_at.
- `checklist_versions`: id, checklist_id, version_number, status (`draft`/`published`), source_kind (`demo`/`official`/`custom`), criteria_json, scoring_policy_json, config_sha256, created_at. Published versions are immutable. Save edits as a new draft/version; only validated published versions can run.

Criteria have stable internal IDs, position, title, instruction, answer kind, scoring mapping, weight, optional section_id, allow_na, na_condition, evidence_source and critical_error behavior. Changing the wording requires a new version even if the ID remains the same. Support arbitrary criterion counts, not exactly eight.

Example shape for an explicitly synthetic criterion:

```ts
type Criterion = {
  id: string;
  title: string;
  instruction: string;
  answerKind: 'boolean' | 'number' | 'choice';
  weight: number;
  scale?: { min: number; max: number; step?: number };
  options?: { id: string; label: string; points: number }[];
  booleanPoints?: { true: number; false: number };
  normalizedMapping: 'linear' | 'explicit';
  maxPoints: number;
  sectionId: string | null;
  allowNA: boolean;
  naCondition: string | null;
  evidenceSource: 'transcript' | 'audio' | 'both';
  criticalErrorRule: string | null;
};
```

Use a discriminated union in actual Zod/TypeScript implementation so irrelevant or missing fields cannot sneak through. Clarify ascending/descending scales through explicit mapping; do not assume a higher answer is always better. Validate nonnegative weights and finite values. A policy with no positive applicable weight yields no numeric score.

### Evaluations, jobs and evidence

- `evaluation_runs`: id, conversation_version_id, checklist_version_id, status, prompt_version, evaluator_config_sha256, text_model, audio_model, idempotency_key, created_at, completed_at, original_totals_json, final_totals_json, review_revision, limitations_json. A complete run must have exactly one assessment per configured criterion. Unique idempotency key for the same requested run.
- `criterion_assessments`: id, run_id, criterion_id, applicability, answer_json, reason, evidence_json, critical_error, validation_state, created_at. Unique `(run_id, criterion_id)`. Initial machine rows are immutable once finalized.
- `evaluation_jobs`: id, run_id, stage, state, attempt_count, lease_token, lease_expires_at, last_error_code, retry_after, cancelled_at, revision, created_at, updated_at.
- `job_steps`: id, job_id, stage_key, input_hash, status, started_at, finished_at, output_reference, error_code. Unique completed step identity prevents redundant downstream calls.
- `audio_observations`: id, run_id or reusable analysis_key, audio_asset_id, model, prompt_version, structured_observations_json, raw_response_private, validation_state, coverage_ranges_json, limitations. Do not reuse rubric-dependent observations across incompatible criteria; simplest safe strategy is cache by rubric version.
- `provider_calls`: id, job_id, stage_key, request_started_at, finished_at, provider_request_id, model, status, usage_json, price_snapshot_json, estimated_cost_usd, uncertainty_note. Include failed and repair calls; never log keys or entire audio base64.

Evidence contract:

```ts
type Evidence =
  | { kind: 'quote'; messageIds: string[]; quote: string }
  | { kind: 'absence'; fromMessageId: string; toMessageId: string;
      expectedAction: string; inspectedScope: string }
  | { kind: 'audio'; audioAssetId: string; startSeconds: number;
      endSeconds: number; observation: string;
      alignment: 'verified' | 'approximate'; speaker: 'operator' };
```

Validate message IDs against the same conversation version. For quotes, validate exact original substrings, or a documented whitespace-only normalization with retained offsets. Do not let a model quote “operator” evidence that belongs to a client. Context quotes may be shown but labeled as context. Absence evidence must include a meaningful inspected range; it is an inference, not proof from a nonexistent quote. Audio ranges must fall within duration and covered segments and identify the operator. Approximate evidence must remain visibly approximate.

### Appeals and audit

- `appeals`: id, run_id, criterion_id, comment, status, created_at. Preserve each appeal; control duplicate pending submissions.
- `review_decisions`: id, appeal_id, action (`uphold`/`replace`), replacement_answer_json nullable, replacement_applicability nullable, replacement_critical_error nullable, reason, evidence_json, expected_review_revision, created_at.
- `score_revisions`: id, run_id, revision_number, decision_id nullable, effective_answers_json, totals_json, scoring_policy_hash, created_at.
- `audit_events`: id, entity_type, entity_id, action, nonsecret metadata, created_at.

A Postgres transaction/RPC locks the run, checks its review revision, validates the decision, inserts the decision and score revision, updates current totals and closes the appeal. Scoring results must come from the tested server scorer; a transaction still validates identity, revision and referenced policy. Return HTTP 409 on stale decisions. Never let two concurrent reviews silently replace each other. The UI's “operator” and “reviewer” views are demonstration roles, not access-control claims.

## Scoring engine

Expose a pure function `calculateScore(checklistSnapshot, effectiveAssessments)` with no model/database/network calls. Store its version/hash with results. Use decimal arithmetic or exact scaled integers for weighted operations; round only at policy-defined stages.

A configurable baseline for TESTS ONLY:

```text
normalized_i = (answer_i - scale_min_i) / (scale_max_i - scale_min_i)
               OR explicit option/boolean score mapping
applicable_weight_sum = sum(weight_i for applicable, successfully evaluated criteria)
effective_weight_i = weight_i / applicable_weight_sum
score_percent = 100 * sum(effective_weight_i * normalized_i)
```

The actual checklist may define different scales, section redistribution, rounding or critical-error effects. Make the supported rules explicit, editable and tested. Do not assume that critical error forces zero; the guide says to mark it separately and apply the supplied checklist. A `critical_error` flag is always separate from any optional score effect.

Key invariants:
- N/A is permitted only when the criterion allows it and its condition is satisfied. Valid N/A weight redistributes according to policy.
- Error, missing audio, ambiguous speaker and unsupported input are NOT N/A. If a required criterion is unresolved, show a partial result without an authoritative final score; do not inflate the total by dropping its weight.
- All N/A or zero applicable weight produces `score: null` with a clear reason. Never divide by zero.
- Section scores use explicit configured membership and policy; do not average section percentages without their intended weighting.
- An override is revalidated against the same immutable checklist. It recalculates from effective answers, not from rounded old totals.
- Show both original weight and effective weight so N/A redistribution is explainable.

Example unit test ONLY: weights 60/40, normalized answers 0.5/1 produce 70 before rounding; if the second criterion is legitimately N/A, the result is 50. These are not the official case numbers.

## OpenAI pipeline

### Separate acoustic observations from final judgment

1. Snapshot the conversation, checklist, model IDs, prompt versions and scoring policy.
2. For voice calls with audio-dependent criteria, fetch and validate the audio, identify usable operator segments and run an actual audio-input model. Supply original transcript as contextual alignment aid, not a replacement for listening.
3. Ask for acoustic observations with cited time ranges, speaker attribution, limitations and uncertainty. Do not ask it to generate speech. Validate output conservatively.
4. Send transcript, dynamic criterion definitions and validated audio observations to the text evaluator using schema-constrained output. The model returns criterion answers and evidence, not trusted arithmetic.
5. Validate complete criterion coverage, values, N/A conditions, quotes, bounds and audio availability. Reject refusals, incomplete output and invalid references. Allow at most one bounded schema/evidence repair call; otherwise mark review/error.
6. Calculate totals with code and persist immutable initial results. Show cost covering ALL pipeline calls.

Start with a single text call for all criteria when context limits permit, not one call per criterion. If the dialogue is too long, use explicit chunk coverage and a final aggregation step; do not truncate the middle silently. Absence findings require coverage of the entire relevant scope. Cache exact inputs, never different rubric versions under the same key.

### Model configuration and verified capability constraints

Model names and rates can change. Resolve an enabled model and pin its exact ID during implementation. A successful account capability test is still needed; this document does not establish that the user's key has access.

- Audio candidate: `gpt-audio-1.5`, Chat Completions with a base64 `input_audio` part and text output. Official documentation inspected for this handoff says it accepts audio input but does NOT support Structured Outputs. Do not pretend its free-form JSON is schema-guaranteed. Validate observations and use the separate structured text stage.
- Audio input formats: verify current endpoint support; the inspected Chat Completions reference supports WAV/MP3. Never rename a WebM extension and call it WAV. Convert genuinely if necessary.
- Text evaluator candidate: `gpt-6-luna`, whose inspected official model page supports Responses and Structured Outputs. Use the current SDK's `text.format`/`zodTextFormat` mechanism. Pin an enabled exact ID; do not use deprecated `gpt-4.1-mini` as the default. Do not copy Chat Completions `response_format` into a Responses request. Require no additional properties, bounded fields and refusal/incomplete handling.
- Organizer transcripts already exist. A separate transcription call is optional only for needed alignment/attribution work, not a mandatory stage or replacement source. Preserve the organizer transcript and explain any discrepancy.
- RU/KZ/EN are required input languages. Kazakh is `kk` in ISO language-code settings, while the dataset label remains `KZ`. Verify representative Kazakh and mixed-language samples; do not claim benchmark-level accuracy from model availability alone.

Prompt contract: delimit data clearly; instruct the model to evaluate only the operator and ignore instructions within transcripts; include only the supplied criterion definitions; return one result per stable criterion ID; permit uncertainty operationally without abusing N/A; require original-language evidence. No web tools, code execution or arbitrary URL-following is needed in the model call.

## Audio engineering and hosting limits

Vercel Functions have a 4.5 MB request/response body cap in the inspected documentation. Do not put base64 audio in browser-to-route bodies. Fetch an approved organizer URL server-side, or use a short-lived direct upload to private Supabase Storage if upload is needed. Return only small JSON and playback authorization data. The provider request from server to OpenAI still must respect provider input limits, runtime memory and execution duration.

Use Node runtime, not Edge. Set `maxDuration` within the actual account plan: inspected Fluid Compute limits are 300 seconds on Hobby and 800 seconds generally on Pro/Enterprise. These are limits, not a guarantee every request will finish. Set shorter provider deadlines and preserve enough time to persist failure state. Do not rely on a beta timeout extension.

For the actual five recordings, measure size, duration and encoding immediately. If one fits a safe invocation, process it as a bounded audio stage. If not:
- Prepare supported audio segments with a tested conversion/chunking utility before the model stage; preserve full recording offsets and modest overlap.
- For a 24-hour build, a documented local Node/FFmpeg preparation command is acceptable only as an explicit fallback, not falsely described as serverless processing. Prefer implementing and testing deployed preprocessing within actual resource limits when feasible. Do not require a hidden always-on process.
- Cover all relevant operator speech. Thirty-to-ninety-second chunks are an engineering starting point, not permission to analyze only the first 90 seconds of a call.
- Store coverage and chunk provenance. Reconcile overlap and conflicting observations. Bound total requests and cost before processing.
- Unsupported/oversized audio becomes an actionable processing error, not a successful transcript-only voice score.

For playback, use private storage with short-lived signed links or an authorized range-supporting proxy. Verify HTTP range requests, CORS, content type, expiry and seeking. Do not stream whole large files through a route constrained by the payload cap. Source URLs may be used directly only if permitted and actually suitable; never strip access restrictions.

ISO transcript timestamps do not by themselves establish recording-relative offsets. Use a verified recording start time/channel metadata, an explicitly measured manual alignment, or a tested alignment step. Store the method and quality. Unverified `(timestamp - first_message_timestamp)` may be displayed as approximate, never as proven exact timing.

## Reliable jobs without fake background work

Use persisted, resumable stages, each awaited within one request. For the hackathon, the browser drives `POST /api/jobs/:id/step`, polls status and requests the next stage after completion. A server-side atomic claim grants a lease token; only one caller may execute the step. An expired lease can be reclaimed according to retry policy. A closed browser pauses pending work; reopening resumes it. Display this limitation. Do not claim an autonomous durable worker exists.

Stages: `prepare` → `audio_segment_n` (when needed) → `text_evaluate` → `validate_and_score` → `complete`. For small conversations, stages may be combined if comfortably bounded. Persist intermediate results after each stage. `waitUntil`, promises left running after the response and local memory are NOT durable queues.

If uninterrupted control-dataset batch processing is essential, add a genuine supported durable workflow/queue or keep the batch page open with clear recovery. A new service is a deliberate scope/setup choice, not a silently assumed dependency. The baseline works without cron granularity assumptions.

Enforce database-backed global/session concurrency (initially 1 audio and 2 text calls, configurable), bounded attempts with jittered backoff, per-call timeouts and cancellation before each next stage. Provider outcomes may be uncertain after a network timeout: do not claim exactly-once billing or blindly replay an unknown paid call. Save request IDs where available, distinguish uncertain status, and require explicit retry when duplicate charging is possible.

Suggested states: `queued`, `running`, `retry_wait`, `needs_review`, `failed`, `cancelled`, `completed`. `needs_review` is not scored as N/A. An atomic lease/unique idempotency key prevents duplicate active runs, but does not magically deduplicate provider-side execution after a timeout.

## HTTP contracts

Validate every request and enforce scope before database access. Example endpoints:

- `POST /api/import` `{ groupId }` or validated JSON upload reference → import summary and conversation IDs. The server supplies the configured base URL; client cannot choose arbitrary hosts.
- `GET /api/conversations?...` → paginated list, no restricted audio/source secrets.
- `GET /api/conversations/:id` → selected version, transcript and allowed result metadata.
- `POST /api/checklists` → create; `POST /api/checklists/:id/versions` → validate and save; `POST .../publish` → immutable version.
- `POST /api/evaluations` `{ conversationVersionId, checklistVersionId, clientRequestId }` → 202 `{ runId, jobId, status }`.
- `POST /api/jobs/:id/step` → one bounded stage, state/lease information; 409 if claimed elsewhere.
- `GET /api/jobs/:id` and `GET /api/evaluations/:id` → progress/results/cost.
- `POST /api/appeals` `{ runId, criterionId, comment, clientRequestId }`.
- `POST /api/appeals/:id/decision` `{ action, replacement?, reason, evidence?, expectedReviewRevision }`.
- `POST /api/audio/:id/playback` → authorized short-lived playback URL with expiry.

Use consistent error `{ code, message, retryable, requestId }`. Do not return stack traces, raw provider payloads or secrets to users. Send appropriate 400/403/404/409/429/502/504 statuses and actionable retry text.

## Security for a login-free demo

“No login UI” is not permission to expose real conversations or paid API calls publicly. Use a session-scoped demo access boundary (for example an unguessable demo access link exchanged once for an HttpOnly, Secure, SameSite cookie), with no account creation. Do not log/query-cache that token; strip it after exchange, set Referrer-Policy and use CSRF/origin checks for mutations. Protect private-data and billable endpoints, not only pages. Rate-limit session and deployment usage, cap request sizes, validate input and escape conversation text as plain text.

The access link is a capability, not user authentication or proof that the reviewer is a different person. For a truly public preview, serve only synthetic fixtures and disable paid execution/private data. Confirm the allowed demo-sharing scope with the user. A public Git repository contains code and synthetic test records, never actual calls, transcripts, private links or secrets.

Enable RLS on every Supabase table and deny direct anonymous access. Use server-only Supabase secret/service-role credentials strictly in the repository layer; they bypass RLS, so the app must enforce access scope on every request. Use a private Storage bucket with no blanket public policy. Signed upload/playback links must be narrowly scoped and short-lived.

For audio downloads, prevent SSRF: server-configured approved hosts, HTTPS, no credentials in URL, reject loopback/private/link-local/metadata IPs, revalidate DNS/redirect destinations, cap redirect count/bytes/duration, verify media type and reject unexpected schemes. Do not let a model supply URLs. Honor organizer data-use rules and transmit only data needed for the approved evaluation to OpenAI; do not add analytics that capture transcripts.

## Environment and costs

Server-only variables, all placeholders in `.env.example`:

```dotenv
OPENAI_API_KEY=
OPENAI_TEXT_MODEL=gpt-6-luna
OPENAI_AUDIO_MODEL=gpt-audio-1.5
SUPABASE_URL=
SUPABASE_SECRET_KEY=
ORGANIZER_API_BASE_URL=
ORGANIZER_AUDIO_ALLOWED_HOSTS=
DEMO_ACCESS_TOKEN=
EVALUATION_BUDGET_USD=
MAX_TEXT_CONCURRENCY=2
MAX_AUDIO_CONCURRENCY=1
PROVIDER_TIMEOUT_MS=
```

Use the actual Supabase credential kind available to the user; a legacy service-role key may be configured under an explicitly named alternative. Do not expose either via `NEXT_PUBLIC_`. Confirm project/region and existing resources before migrations or deployment. Keep `.env.local`, recordings and raw datasets out of Git; provide safe fixture seeds.

Budget enforcement uses atomic reservation before a model call and reconciliation afterward. Estimate conservatively using input size/duration and output limits. Record uncertain reservations rather than freeing them blindly after timeouts. Let the user choose a cap within the verified balance; do not treat $50 as blanket permission to exhaust it.

Initial official Standard rate snapshot checked 7 November 2026 (USD per 1 million tokens):
- `gpt-6-luna`: text input $0.10; cached input $0.01; output $0.50. Recheck actual model, context tier and billing before use.
- `gpt-audio-1.5`: audio input $32; text input $2.50; text output $10. Do not request unnecessary audio output (listed at $64 per million audio output tokens).
- No transcription cost in the default pipeline because transcripts are supplied.

These rates are not a total per-call estimate. Total audio cost depends on measured audio tokens and all supplementary text calls. Store a dated pricing snapshot by model and token category. Compute:

```text
estimated_total_usd = sum(all provider calls for the evaluation)
call_cost = sum(usage_in_category * USD_per_million_for_category / 1_000_000)
```

Do not double-count cached tokens and uncached input; normalize provider usage fields explicitly. Separate audio input tokens from text input/output. Include normalization, retries and any optional alignment/transcription. Use estimated labels if usage or rate is incomplete. Report real measured sample costs, not a fabricated fixed “cost per dialogue”. Storage/hosting costs are separate from the model estimate.

## Verification and deployment runbook

1. Validate environment placeholders and key access without exposing values. Apply reviewed Supabase migrations and synthetic seed in the intended project only when authorized.
2. Start locally; run schema, scoring and state-machine tests. Test the official checklist once received.
3. Verify one real chat and one full call, including provider usage and speaker/audio evidence. Do not run the full dataset merely to check connectivity.
4. Run `lint`, `typecheck`, unit/integration tests and production build. Run Playwright for the full appeal/review flow and unknown criterion replacement.
5. Configure Vercel server secrets, Node runtime, permitted duration, security boundary and correct Supabase project. Deploy when authorized; verify build identity and deployed smoke tests rather than assuming local success transfers.
6. Test refresh/retry, session expiry, private playback expiry, duplicate submissions, budget exhaustion and a failed audio file.
7. Make README precise: setup, current model IDs/prices, supported formats, safe local audio fallback if used, restrictions, control-group import and final commit freeze.
8. At hour 23 process the control group on the tested build. At hour 24 retain commit SHA/deployment ID. Any later checklist modification creates a data version, not a code change.

## Source references and verification date

Primary requirements: `CQA_Hackathon_Student_Guide_v3.pdf`, pages 1–4, supplied by the user. Official checklist remains pending.

Technical documentation checked for this handoff on 7 November 2026; recheck live limits/access before implementation:
- OpenAI audio guide: https://developers.openai.com/api/docs/guides/audio-chat-completions
- OpenAI text model: https://developers.openai.com/api/docs/models/gpt-6-luna
- OpenAI audio model: https://developers.openai.com/api/docs/models/gpt-audio-1.5
- Chat Completions input schema: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- Pricing: https://developers.openai.com/api/docs/pricing
- Vercel Function limits: https://vercel.com/docs/functions/limitations
- Vercel function lifecycle API: https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package

These sources establish API capabilities and platform limits, not the user's model access, actual credit, audio suitability or accuracy on the organizers' Kazakh examples. Those require implementation-time checks.
