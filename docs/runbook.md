# Runbook

What to do when something goes wrong, when a client onboards, and when a new doc type lands. Linked from the client-facing one-pager you hand over after deployment.

## Daily Health Check

Open your n8n instance. For each active workflow:
- Last execution: within polling interval? (1 minute for Gmail/Drive triggers)
- Last 24h success rate: > 85% acceptable, < 70% investigate.
- Stuck executions: any "running" for > 5 minutes? Cancel and investigate.

If review queue (Sheets `review_queue` tab) has > 20 unhandled rows, page yourself.

## Common Incidents

### A document didn't process
1. Search Gmail/Drive trigger executions for the filename.
2. If trigger fired but no downstream execution: text length gate likely tripped — check the `Build Envelope` node output, look at `raw_text.length`.
3. If classifier ran but no extractor fired: check `Confidence Gate` and `Type Switch` outputs in the classifier execution. Likely classified as `unknown` or low confidence.
4. If extractor ran but no Sheets/Notion row: check `Validation Gate` output. Validation likely failed.
5. Either way, the doc should be in the review queue with a `review_reason`.

### A document landed in review that shouldn't have
1. Check `validation_errors_json` column in the review row.
2. If it's a `confidence:overall:X` error and X is just under 0.8, the LLM was unsure. Either:
   - Manually copy the LLM's extraction into Sheets and move on.
   - If this happens > 5% of the time, tune the prompt (add a few-shot example of the type that fails).
3. If it's a `date:not_iso` or `currency:not_iso_3` error, the LLM didn't normalize. Tighten the prompt's normalization instructions.

### LLM returns invalid JSON
1. The `Parse JSON` Code node catches this and sets `confidence: 0`, which routes to review.
2. Common causes: model wrapped JSON in ` ```json ... ``` ` markdown fences. Update the prompt to say "no markdown fences."
3. Or model truncated mid-response: bump `max_tokens` for that extractor.

### OpenRouter rate limit / outage
1. n8n shows HTTP 429 or timeout in the LLM call.
2. Built-in retry (3x with 2s wait) handles transient cases.
3. For sustained outages: pause Gmail/Drive triggers manually, wait, resume. Pending docs catch up via Gmail polling.
4. Backup model: change `model` in the HTTP Request body from `openai/gpt-4o-mini` to `anthropic/claude-haiku-4-5-20251001` (slightly more expensive, comparable quality on extraction).

### Sheets quota exceeded
1. Google Sheets API quota: 60 writes/min/user, 300 reads/min/user.
2. If hit (HTTP 429 in router): n8n retries. If sustained: split clients across multiple Google service accounts.

### Notion API rate limit
1. ~3 requests/sec average. Bursts allowed.
2. n8n Notion node retries automatically. If sustained: queue Notion writes through a separate workflow with a Wait node.

## Per-Client Onboarding (Quick)

Full version in `docs/setup.md`. Quick version:

1. `cp config/client-config.example.json config/client-config.<client_id>.json`
2. Fill in: `client_id`, Gmail address, Drive folder ID, Sheets/Notion IDs, Telegram chat ID, doc types, form fields if any.
3. In n8n: set the Gmail label filter and Drive folder ID in workflows 01 and 02.
4. Update the `clientConfig` block inside the `Build Envelope` Code nodes (workflows 01 and 02) to load the right config (or wire it to a Workflow Variable).
5. Test: drop a sample invoice into the watched Drive folder. Should land in Sheets within 60 seconds.
6. Hand over the one-page client runbook (template in `references/`).

## When a New Doc Type Comes In

A client sends something that's not invoice/contract/form (e.g., bank statements, delivery notes).

1. Check volume. < 10/month: route to review, handle manually.
2. > 10/month: add a new type. Steps:
   - `workflows/prompts/<type>-extraction.txt` — write the prompt.
   - `docs/specs.md` — add the schema.
   - `n8n-exports/08-<type>-extractor.json` — copy 04 (invoice) and adapt.
   - Update `tests/validators.js` and add fixtures.
   - Add to classifier prompt's allowed types.
   - Add a branch to workflow 03's Type Switch.
   - Run `node tests/run-tests.js` before deploying.

## When the Validator Logic Changes

The validator runs in two places: the n8n Code nodes and `tests/validators.js`. They must stay in sync.

1. Make the change in `tests/validators.js` first.
2. Run `node tests/run-tests.js` to confirm it does what you want.
3. Copy the function body into the corresponding n8n workflow's `Validate` Code node.
4. Re-export the n8n workflow JSON to `n8n-exports/`.
5. Commit both changes together with a decision-log entry if behavior is meaningfully different.

## Useful Queries (when Supabase audit log is on)

```sql
-- review queue rate, last 7 days, per client
SELECT client_id,
       count(*) FILTER (WHERE status = 'review') * 1.0 / count(*) as review_rate,
       count(*) as total
FROM audit_log
WHERE received_at > now() - interval '7 days'
GROUP BY client_id;

-- avg confidence by doc type
SELECT type, avg(extraction_confidence), count(*)
FROM audit_log
WHERE received_at > now() - interval '7 days'
  AND status = 'logged'
GROUP BY type;

-- spike check: docs/hour today
SELECT date_trunc('hour', received_at), count(*)
FROM audit_log
WHERE received_at >= current_date
GROUP BY 1
ORDER BY 1;
```

## Escalation

If you can't fix something in 30 minutes:
1. Pause all triggers (toggle "active" off on workflows 01 and 02).
2. Dump the failing executions to a JSON file (n8n UI -> Executions -> Export).
3. Telegram the client: "DocFlow paused for ~1 hour, investigating. Your docs are queued, nothing lost."
4. Restart from the latest known-good n8n-exports JSON if needed.

Never silently drop a document. The whole product premise is "you always know where every doc is."
