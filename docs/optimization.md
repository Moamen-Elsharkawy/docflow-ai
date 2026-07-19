# Optimization Notes

Concrete optimization levers across cost, latency, accuracy, and reliability. Apply selectively as volume grows.

## Cost Optimizations

### 1. Pre-classifier filename + sender heuristic (free)
Before calling the classifier LLM, check filename and sender against simple rules. If the signal is unambiguous, skip the classifier.

```
filename matches /invoice|receipt|bill|inv[-_ ]/i  -> assume "invoice", confidence 0.85
filename matches /contract|agreement|nda|lease/i   -> assume "contract", confidence 0.85
sender domain in client_config.invoice_senders     -> assume "invoice", confidence 0.9
```

If the heuristic confidence >= 0.85 AND classifier is set to skip on heuristic, save one LLM call (~$0.0001). At 5,000 docs/month that is meaningful only if cumulated; the real savings come from skipping the more expensive extractor on unknowns.

### 2. Truncate raw_text to model-relevant range
Most invoice content is in the first 2-3 KB. Long PDFs (annexes, appendices) waste tokens. Truncate to first 8,000 characters before sending to extractor. Add a check: if total length > 12,000 chars, run a second pass on the tail and merge.

### 3. Compact the system prompt
Current invoice prompt: ~250 tokens of system message. Trim to ~150 by removing examples and embedding the schema as a one-line type signature. Net saving: ~30% on classifier, ~10% on extractors.

### 4. Cache classifier results by document hash
If the same PDF is sent twice (Gmail forwards, retry uploads), hash the raw_text (SHA-256) and check a Redis or in-memory cache before classifying. TTL: 24 hours.

### 5. Use cheaper models for classification only
Classifier doesn't need GPT-4o-mini. `openai/gpt-4o-mini` is already cheap, but `meta-llama/llama-3.1-8b-instruct` via OpenRouter is roughly 5x cheaper for classification quality that's "good enough." Test on 50 docs before switching.

## Latency Optimizations

### 1. Parallelize text extraction and client lookup
The intake workflow currently extracts text then looks up client config. Run both in parallel — they don't depend on each other.

### 2. Stream LLM responses (advanced)
For extractors with `max_tokens: 1500`, the LLM call is the longest stage (3-8 seconds). OpenRouter supports streaming. n8n's HTTP Request node doesn't natively, but a Code node can fetch with `fetch()` + ReadableStream.

### 3. Skip Telegram on success in high-volume deployments
Once a client is processing 100+ docs/day, per-doc Telegram messages become noise. Switch to a daily summary: `audit_log` → daily Cron job → "Today: 137 invoices logged, 4 reviewed, $X total."

## Accuracy Optimizations

### 1. Per-field confidence (vs only overall)
Current: LLM returns one `confidence` score. Better: ask the LLM for a `field_confidence` map. Then the validator can route to review if a critical field (e.g., `total_amount`) is below 0.7 even if overall confidence is 0.9.

Prompt addition:
```
Also include "field_confidence": {field_name: 0..1, ...} for each extracted field.
```

### 2. Few-shot examples in prompts
Current prompts are zero-shot. Add 2-3 few-shot examples of clean → JSON pairs at the end of each extractor system prompt. Costs ~300 extra tokens per call but lifts accuracy on edge cases (Arabic, mixed currencies, weird date formats).

### 3. Two-pass extraction for low-confidence runs
If overall confidence is between 0.6 and 0.8, run a second extraction with `temperature: 0.0` and a stricter prompt. If both runs agree on critical fields, accept; if they disagree, route to review with both runs in the alert.

### 4. Vendor/party normalization map
Maintain `client_config.vendor_aliases = {"Acme Supplies Co.": "ACME", "Acme Supplies": "ACME"}`. Apply post-extraction so the same vendor always lands as the same string in Sheets. Avoids fuzzy-grouping in downstream reports.

## Reliability Optimizations

### 1. Idempotency keys
Hash `(client_id + doc_id + extracted.invoice_number)` and put it in a "Processed" Sheets column or Supabase unique index. Prevents duplicate rows on n8n retries.

### 2. Dead-letter queue
On 3 failed retries (LLM 5xx, Sheets 5xx, Notion 5xx), drop the envelope into a `dead_letter` Sheets tab with the full error. Manually replay from there.

### 3. Circuit breaker on OpenRouter
If 5 consecutive LLM calls fail, pause the Gmail trigger for 10 minutes. Avoids burning through retry budget when OpenRouter is down. Use n8n's `Wait` node + a Workflow Variable as a pause flag.

### 4. Graceful Drive folder pagination
Drive trigger polls the folder. If 50+ files arrive at once (bulk upload), n8n processes them serially. To speed up, switch the trigger to poll for new files, but immediately enqueue each into a separate sub-workflow execution.

## Operational Optimizations

### 1. Versioned prompts with A/B
Keep prompt files versioned: `invoice-extraction.v1.txt`, `invoice-extraction.v2.txt`. Workflow reads the version from `client_config.prompt_versions.invoice_extraction`. Roll out v2 to one client first, compare review-queue rates, then promote.

### 2. Sample document sandbox
A separate n8n workflow (`99-sandbox.json`, not built) accepts a webhook with raw text + expected JSON, runs the full pipeline, diffs result vs expected. Use it for prompt regression testing without touching production triggers.

### 3. Per-client metrics
Augment the audit log with: `tokens_in`, `tokens_out`, `llm_cost_usd`, `processing_seconds`. Roll up weekly per client. Lets you price retainers more precisely and spot drift early.

### 4. Periodic validator drift audit
Run `node tests/run-tests.js` as part of any prompt or schema change. Add it to a pre-commit hook.

## When to Apply What

| Trigger | Optimization to apply |
|---|---|
| First paying client | Idempotency keys, dead-letter queue |
| Hitting 100 docs/day | Filename heuristic, daily summary instead of per-doc Telegram |
| Hitting 500 docs/day | Cheaper classifier model, document hash cache |
| Client complains about errors | Per-field confidence, few-shot examples, two-pass extraction |
| Client adds 2nd vertical | Versioned prompts, prompt sandbox |
| OpenRouter outage | Circuit breaker, fallback model in retry config |

Don't apply optimizations preemptively. Each one adds complexity. Wait for the symptom that justifies the cost.
