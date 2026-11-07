# Official submission export

Source: `CQA_Student_Guide_Appendix_Results.pdf` supplied by the organizers.

In **Запуски → Официальная сдача: results.json**:

1. Select the required checklist version in the main version selector.
2. Enter the actual team name and select the imported organizer dataset.
3. Choose DEV (exactly 60 chats and 5 calls) or PROD (exactly 10 chats).
4. Select original AI findings or the current findings including explicitly confirmed appeals. These are never mixed implicitly.
5. Download `results.json`, or on the local unauthenticated loopback workspace save directly to `results/dev/results.json` or `results/prod/results.json`. Saving replaces that file; it does not commit or push.
6. Check the displayed error count. Missing, failed, pending, invalid, or review-only assessments are included as `status: error`, `criteria: []`, `score: null`; exporting is not proof of assessment completeness.
7. Review and push the two required files before the organizer's stop-code. Neither API keys, transcripts, audio URLs, nor full provider responses are exported. Brief criterion rationales and evidence turn numbers are included as required.

The exporter uses the latest import manifest and matches exact imported content, chosen rubric version, and provider (voice uses Gemini). Earlier content and another version/provider cannot silently supply scores. The last primary run is selected; AI review proposals are not exported until explicitly accepted into the current findings. Model names come from call records. `No model invoked` explicitly means there were no selected calls, not a tested model.

Schema: root `schema_version: "1.0"`, `team_name`, `model: {mode: "external_api", name}`, `results`. Canonical criterion IDs: `contact`, `discovery`, `identification`, `consultation`, `empathy`, `dialogue`, `closure`, `critical`. Booleans remain JSON booleans. N/A is JSON null only for discovery, identification, consultation and closure. Consultation permits 0/5/10/15/20; dialogue permits 0/4/7/10. Evidence is one-based in the full original transcript. The score is recomputed from the selected rubric, rounded half-up to two decimals; critical_flag follows the critical answer without automatically zeroing the score.

Modified criteria that cannot fit the official answer types are exported as an explicit error, never coerced. A rubric without the eight expected IDs or with incompatible total rounding is rejected.

The existing **Скачать оценки по критериям** control-group export is an internal diagnostic format, not the official submission.

## Full DEV batch

In **Запуски → Контрольная группа**, choose the imported dataset and **DEV — 60 чатов и 5 звонков**. The server validates the latest import manifest and selects all 65 exact records; it does not silently use stale revisions. Chats use the configured text provider, calls use Gemini. Existing primary runs for the same document, version and provider are not duplicated; choose a new checklist version to reassess the group. Processing remains sequential with the existing quota, retry, cancellation and pause protections.

Free-provider processing is restricted to built-in synthetic examples plus a narrow allowlist for the 60 original synthetic text chats in one specifically authorized DEV import, sent only to Groq with `openai/gpt-oss-120b`. The server verifies the exact import hash, each original document and its content; edited transcripts, other imports, models and providers are not covered. This exception does not authorize real calls or PROD data. A group containing any disallowed record is rejected atomically before queueing, so the full 65-record DEV group remains blocked while its five calls lack an approved processing arrangement. Provider quotas and local request limits still apply to allowed chats. No model requests occur when exporting.

The team-name field defaults to Aegis and remains editable. Exporting/saving does not submit, commit, publish or push anything.
