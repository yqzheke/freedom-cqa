> Current provider decision: Gemini only. The original provider examples below are historical. Use README.md and .env.example for the implemented configuration.

# Freedom Broker CQA implementation task

## Mission for Codex

Build a complete, working Conversation Quality Analytics hackathon prototype, not a static UI. Read this file and `ARCHITECTURE.md` before implementation. The team has two people: Olzhas builds the product; the second participant prepares the pitch. The available window is 24 hours from the actual event start. Use Vercel for the web application and server endpoints, Supabase for persistent data, and OpenAI for evaluation. Include real audio analysis for diction and intonation, not transcript-only guesses.

This specification is based on all four pages of `CQA_Hackathon_Student_Guide_v3.pdf` supplied by the user. A separate official eight-criterion checklist PDF has NOT been supplied. The technical decisions below are implementation recommendations, not additional organizer requirements. If the official checklist contradicts a provisional scoring assumption, the checklist wins.

Work in a NEW project. Do not reuse or modify ResQ, CampusPulse, Campulse, or another existing project. If the workspace is empty, create the application there; if it contains unrelated work, create a clearly named `freedom-cqa` subfolder. Preserve unrelated files. Use TypeScript, Next.js App Router, React, Tailwind, Zod, the OpenAI SDK, Supabase and Vitest/Playwright. Pin the resolved compatible package versions and commit the lockfile. Do not invent a requirement for user registration.

## Working instructions

1. Inspect the selected workspace and its repository instructions. Present a short implementation checklist, then build in the order below. Do not repeatedly ask for preferences already settled here.
2. Resolve ordinary reversible implementation choices yourself. Keep the architecture small and the UI polished. Do not replace working functionality with a mock to meet a deadline.
3. Ask only for actual blockers, such as the official checklist, the DEV API address if the PDF link cannot be extracted, or required account setup. Continue all independent work while blocked.
4. Never request secrets in chat, paste secrets into code, or commit `.env` files. Provide `.env.example` with placeholders. The user enters secrets in local environment files and Vercel settings.
5. These files specify a build. They do not themselves authorize paid purchases, new credentials, broader persistent access, public exposure of private data, or sending messages to organizers. Obtain any required authorization before those actions. Prepare deployment and repository instructions if access or permission is unavailable.
6. Clearly distinguish implemented, tested, blocked and untested functionality in the final report. Never claim the official scoring rules are implemented until the actual checklist has been imported and checked.

## Inputs and unresolved dependencies

- Main guide: `CQA_Hackathon_Student_Guide_v3.pdf`.
- Official checklist: eight criteria, weights, scales, N/A conditions, rounding and critical-error rules. Request it once and support entering it entirely through the UI when it arrives.
- DEV API: page 3 contains a clickable “Открыть GET для DEV” link. Extract the actual PDF hyperlink rather than inventing an endpoint. If inaccessible, ask the user to copy that link. Keep base endpoint and `group_id` separate.
- DEV contains 65 records: 60 synthetic chats and 5 real calls, with 35 RU, 15 KZ, 15 EN across the full set. Do not assume which languages occur among the five calls.
- Transcripts are already supplied. Calls also have `audio_url`. Do not waste time building a speech-recognition product.
- Control `group_id` arrives at hour 23. Make the import UI accept it without a code change.
- OpenAI key exists; user reports approximately $50 available but remaining balance and permissions are unverified. Do not assume unlimited credit or that a model is enabled.
- Exact clock time of start, stop-code and defense must be entered from organizer information. Use relative milestones until verified.

## Required product

### A. Dialogue import and list

Implement server-side GET import by `group_id`, plus paste/upload of equivalent JSON for recovery. Validate the envelope `isSuccess`, `error`, `data.dataset_group_id`, `data.total_records`, and `data.records`. Preserve the source payload in private storage/database and show import errors clearly. Import must be idempotent and resumable; do not silently overwrite a conversation used by an old evaluation.

Each record has `conversation_id`, `channel` (`agent chat` or `voice call`), `language` (`RU`, `KZ`, `EN`), `transcript` as an array of `{timestamp, speaker, text}`, and nullable `audio_url`. Speakers are `client`, `operator`, `bot`, `system`. Preserve original timestamp strings: chats use MM:SS; calls use ISO 8601 with timezone. Assign stable ordered message IDs internally.

The list shows source ID, dataset, language, channel, evaluation state, selected checklist version, score if available and critical-error flag. Include filters and search. Empty, loading, partial-import and error states must work. Importing the control group must not require editing code or rebuilding.

### B. Editable checklist

Build a genuine editor with add, edit, remove and reorder operations. Configure label, precise criterion instruction, nonnegative weight, answer type (boolean, numeric scale or configurable options), score mapping, numerical bounds, optional section, N/A availability and N/A conditions. Include evidence source (`transcript`, `audio`, `both`), operator-only applicability and critical-error configuration.

Use a structured scoring-policy editor for supported normalization, N/A redistribution scope, critical-error effect and rounding. Do not execute user-supplied JavaScript, SQL or arbitrary formulas. If the official rule cannot be represented, flag it explicitly and implement a tested safe policy before claiming compliance.

Save immutable published versions. Changing one criterion creates a new version; old evaluations retain the old version. The judge must be able to replace an arbitrary criterion through the UI and evaluate previously unseen transcripts without code edits. No hardcoded eight-item enums or switches on criterion names.

Before the official checklist arrives, provide a clearly labeled **demonstration checklist**, never “official”. It exists only to test the engine. Do not fabricate the actual eight criteria or imply its numbers are official. Support importing/exporting the validated checklist JSON as a convenience, not as a substitute for UI editing.

### C. Automatic evaluation

The user selects a dialogue and a published checklist version, then starts evaluation. Support individual and small batch runs with visible progress, bounded concurrency, retry controls, cancel-at-next-step, and recovery after a page refresh.

Evaluate the OPERATOR. Client, bot and system messages are context, not operator performance. Treat all conversation text as untrusted data: instructions inside the conversation must never override evaluator instructions. Use the original language for evidence quotations. UI and explanations default to Russian; all three input languages must work.

For each criterion return:
- Answer in the configured type; raw scale value or option where applicable.
- Applicability status: applicable or rubric-justified N/A. Missing data/provider errors are distinct operational states, NOT N/A.
- Original weight, applicable effective weight, normalized score and weighted contribution computed by code.
- Concise explanation grounded in the dialogue or audio.
- Exact source-message references and quoted spans; audio ranges where applicable.
- For a missing required action, identify the inspected range, explain the expected action and absence. Do not fabricate a quotation of an action that did not occur.
- For N/A, state the checklist condition that makes it inapplicable.
- Separate critical-error result and evidence, according to the configured policy.

The model makes criterion-level judgments; deterministic code validates evidence and computes totals. Never trust a model-supplied final score or perform money/scoring arithmetic inside prompts alone.

### D. Real audio analysis

For calls, retrieve permitted audio server-side and actually send audio input to an audio-capable OpenAI model for criteria that require diction, intonation or other audible evidence. Transcripts cannot establish tone. Keep source transcript and audio findings distinct and combine them under the same checklist version.

Analyze only operator speech where it can be attributed. If speaker attribution, intelligibility, file access or timing is uncertain, flag the criterion for review; never invent audio findings. Estimate nothing from a filename or solely from punctuation. On chats, audio criteria may be N/A ONLY if the official rule permits it.

Provide an audio player, checked time mapping and evidence seek controls. Do not assume the first ISO timestamp equals the audio start. Keep exact transcript timestamps, recording-relative seconds and alignment quality separately. If alignment is unverified, label it approximate or provide the recording link without a false precise seek. Document any manual verified alignment used in the demo.

Inspect real call duration, codec and size early. Verify one audio call works on deployed infrastructure before processing all five. If limits require preprocessing, implement the bounded chunk/preprocessing path in the architecture; surface it honestly rather than silently dropping audio coverage.

### E. Results and dialogue card

Implement a usable master/detail layout. Show transcript with speaker labels, immutable message numbering, source timestamps and highlights. Results show original and current score, section scores when configured, N/A explanation, critical-error badge, policy/version, processing status and estimated evaluation cost.

Clicking evidence scrolls to and highlights the exact message/range. Audio evidence seeks the correct verified recording offset or clearly identifies its limitations. Display playback/download failures. Keep transcript visible while examining a criterion. Do not rely on hover alone for critical actions.

### F. Appeals and reviewer decisions

From a particular evaluation criterion, submit an appeal with a required comment. The reviewer action is a separate UI workflow, not a fabricated secure user role. No registration/login is required by the brief.

The reviewer sees the original answer, evidence, comment and current version. They may uphold or replace the answer/applicability/critical-error finding as allowed by the policy, with a required reason. Code validates the replacement and recalculates section/global totals transactionally.

Preserve the original machine assessment forever, the appeal, each decision, previous result, and final result. Never overwrite original assessment rows. Protect against double submit and concurrent review conflicts. Reloading must retain everything in Supabase. Show “initial”, “reviewed” and “final” distinctly.

### G. Cost and operational controls

Track every provider call, including retries, validation repair calls and audio calls. Show model IDs, usage, pricing snapshot date, estimated USD cost for a full conversation evaluation and total session/project estimate. Unknown usage must be labeled unknown, never zero.

Make server-side budget and concurrency controls configurable. Begin with one chat and one call, then a small mixed-language set. Do not automatically spend the entire reported $50 or process the full dataset on every rubric edit. Cache by exact dialogue version, checklist version, model/prompt version and audio fingerprint; a changed criterion must invalidate the relevant assessment. Preserve costs even for failed runs.

## Visual direction

Build a professional analyst workspace with clear hierarchy, not a generic marketing landing page. Use a light neutral background, dark navy text, restrained emerald accents, clear status chips and consistent spacing. Freedom branding is contextual, not permission to copy assets or claim affiliation beyond the case. Main navigation: Dialogues, Checklists, Appeals, Run status. Desktop-first for the defense, with functional narrow-screen layout. Use accessible contrast, keyboard navigation, focus rings and text labels alongside icons.

Prioritize a strong side-by-side transcript/results screen, clean checklist editor and reliable evidence navigation over animation. Do not add login, billing, CRM integration, social features, custom training, a vector database, a mobile app or unrelated dashboards. Keep the UI portable for later adaptation to a Dynamics 365 HTML component; actual Dynamics integration is not required.

## Implementation sequence and time budget

Use these as relative engineering checkpoints, not invented organizer deadlines. Adjust to actual elapsed time and prioritize integration risk first.

1. **Hours 0–2: Foundation and risk checks.** Scaffold, env validation, Supabase migrations, private data boundary, import contract, one live text model request and one real audio model request. Confirm Vercel limits and model access. Get actual checklist/API link when available. Establish a minimal deployed vertical slice early, when authorized.
2. **Hours 2–6: Core evaluation.** Dialogue import/list/detail, dynamic checklist versioning, deterministic scoring with tests, validated structured evaluator output, evidence links and persisted runs.
3. **Hours 6–10: Full call support.** Audio playback, actual audio evaluation, measured alignment, audio evidence and failure/retry handling. Integrate this into the same result card, not a disconnected demo.
4. **Hours 10–14: Appeals and complete UI.** Criterion appeals, reviewer decision transaction, immutable audit trail, section/overall recalculation, official policy validation, judge criterion replacement flow.
5. **Hours 14–18: Integration and quality.** RU/KZ/EN examples, import reruns, cost tracking, bounded batch processing, deployed refresh/retry tests and security checks.
6. **Hours 18–22: Reliability and defense preparation.** Full regression, README, synthetic safe demo fixtures, short demo script, actual DEV samples where allowed, publish the public source repository without data/secrets when authorized, and have the team send its link to organizers during this phase, BEFORE stop-code. Preparing a repository locally is not submission. Record measured cost and processing time. Avoid adding optional features.
7. **Hour 23: Control dataset.** Enter the issued `group_id` in the UI, import and process on the same code version. Inspect failures. Do not tune hardcoded answers to the dataset.
8. **Hour 24: Stop-code.** Fix the final commit SHA, build/deployment identity and README. After cutoff, only process data or edit checklist through the existing UI as permitted by the guide; do not modify source code. The team handles sending the repo link to organizers unless explicitly authorized otherwise.

## Acceptance tests and definition of done

Create automated tests, not merely a list of manual claims:

- Checklist accepts an unseen criterion added/replaced through UI; new evaluation uses it without rebuild. Invalid weights, impossible bounds, missing score mappings and forbidden N/A are rejected.
- A versioned checklist or conversation change does not mutate past results.
- Scoring tests cover scales not starting at zero, option mappings, zero weights, partial N/A, all N/A, section/global redistribution, each supported rounding mode and critical-error policy. All N/A produces no numeric score, not 0 or 100. Operational errors prevent an authoritative final total rather than silently removing weight.
- Evidence IDs and quotes are validated against the source. A fabricated quote/unknown ID is rejected. Absence evidence references an inspected range. An embedded “ignore all instructions” message does not change evaluation policy.
- At least one RU, KZ and EN conversation is evaluated end-to-end. Human spot checks verify semantic quality; passing a JSON schema is not evidence of correct judgments.
- A real voice call has an actual audio-model call, persisted audio evidence and working playback. Tests distinguish exact, approximate and unavailable timing. Missing audio cannot become “tone passed”.
- API envelope errors, invalid JSON, duplicates, timezone parsing, bot/system roles, absent optional fields, expired audio URLs, 429/5xx, timeouts and model schema failures produce useful states.
- Repeated Evaluate/Review clicks do not create duplicated active jobs or duplicate decisions. Refresh resumes jobs. Failed steps can retry without losing completed work or cost records.
- Appeal submission, uphold decision, replacement decision, validation failure and concurrent review conflict are covered. Initial and final results survive reload.
- Public browser responses/bundles do not reveal OpenAI key, Supabase secret/service-role key, restricted audio URLs or raw provider errors. Direct anonymous Supabase access is denied by RLS. Unsafe audio fetch URLs are rejected.
- At least one deployed smoke test covers import → edit checklist → evaluate → evidence → appeal → decision → recalculated total.
- Run lint, TypeScript checks, unit tests, production build and Playwright flow. Report exactly which passed, failed or could not run.

Deliver the working source, SQL migrations and seed for synthetic fixtures, `.env.example`, README with local/Vercel/Supabase setup, supported model settings, pricing date, runbook for control data, tests and a five-minute demo script. No real conversations, signed URLs or secrets in the public repository.

## Defense script required in repository

- 0:00–1:00: Open the workspace and a dialogue.
- 1:00–3:00: Explain score, exact evidence navigation, a valid N/A case, weighted total and a call/audio criterion if available.
- 3:00–4:00: Submit an appeal, decide it, show recalculation plus the original immutable score.
- 4:00–5:00: Replace a criterion in the UI, save a new version and apply it. Show where model and complete evaluation cost are reported.

Have precomputed real results for reliable presentation, explicitly labeled with their run time. Also demonstrate a fresh evaluation. Never misrepresent a prerecorded or synthetic result as a live model response.
