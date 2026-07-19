# Setup and Per-Client Onboarding

## One-Time n8n Setup

### Credentials to create in n8n

| Credential | Type | Source |
|---|---|---|
| Gmail OAuth2 | Google OAuth2 | GCP project, scope `https://www.googleapis.com/auth/gmail.modify` |
| Google Drive OAuth2 | Google OAuth2 | scope `https://www.googleapis.com/auth/drive` |
| Google Sheets OAuth2 | Google OAuth2 | scope `https://www.googleapis.com/auth/spreadsheets` |
| Notion API | Notion API token | Notion -> Settings -> Connections -> internal integration |
| Telegram Bot | Telegram API | BotFather, save bot token |
| OpenRouter | HTTP Header Auth | header name `Authorization`, value `Bearer sk-or-v1-...` |

Same OAuth2 client can power Gmail, Drive, and Sheets if scopes are combined.

### Environment variables (n8n host)

```
N8N_ENCRYPTION_KEY=...          # set once, never change
WEBHOOK_URL=https://n8n.your-domain.com
DOCFLOW_OPENROUTER_MODEL=openai/gpt-4o-mini
DOCFLOW_DEFAULT_LANG=en
```

### Workflows to import

Import order matters because workflows reference each other:

1. `n8n-exports/07-review-notifier.json` (no inbound deps)
2. `n8n-exports/04-invoice-extractor.json`
3. `n8n-exports/05-contract-extractor.json`
4. `n8n-exports/06-form-extractor.json`
5. `n8n-exports/03-classifier.json` (calls 04/05/06)
6. `n8n-exports/01-gmail-intake.json` (calls 03)
7. `n8n-exports/02-drive-intake.json` (calls 03)

After import, open each workflow and re-link the `Execute Workflow` nodes to point to the freshly imported workflow IDs (n8n regenerates IDs on import).

## Per-Client Onboarding (10-step checklist)

### What to collect from the client

1. Gmail address to watch (or label, if they want only labeled mail processed).
2. Drive folder to watch (folder ID from the URL).
3. Telegram chat ID (after they message your bot, look it up via `https://api.telegram.org/bot<TOKEN>/getUpdates`).
4. Doc types in scope: invoice, contract, form (any subset).
5. For invoices: Sheets spreadsheet ID + tab name.
6. For contracts: Notion database ID + workspace.
7. For forms: field list and destination (Sheets or Notion).
8. Confidence thresholds (default 0.7 classify / 0.8 extract; tighter clients dial up to 0.85 / 0.9).
9. Languages they expect (English, Arabic, mixed).
10. Sample documents (5-10 per type) for prompt tuning.

### What to set up on your side

1. Copy `config/client-config.example.json` to `config/client-config.<client_id>.json`.
2. Fill in the values from above.
3. Add the new `client_id` to the lookup map in workflow 03 (classifier) so envelopes get tagged.
4. Add the client's Gmail address as a labeled filter in your Gmail intake workflow's trigger.
5. Add the client's Drive folder ID as a watched folder in workflow 02.
6. Run the `tests/run_validator_tests.py` to confirm prompts and validator behave on their sample docs.
7. Ship a test invoice end-to-end and watch it land in their Sheets.
8. Hand them a one-page runbook (what to do if a doc lands in review queue).

## Folder + File Permissions

| Resource | Who needs access | Why |
|---|---|---|
| Watched Drive folder | n8n service account (read), client team (write) | client drops files; n8n reads |
| Output Sheets | n8n service account (write), client team (read/write) | n8n appends rows; client reviews |
| Notion database | n8n integration (write) | n8n creates pages |
| Telegram chat | client owner only | private notifications |

## Cost Ceiling (Phase 1)

Per processed document:
- Classifier call: ~500 input tokens, ~30 output tokens -> ~$0.0001
- Invoice extractor: ~1500 input tokens, ~400 output tokens -> ~$0.0005
- Total per invoice: under $0.001

At 500 invoices/month: ~$0.50 in LLM costs. Effectively a rounding error against the $75-150/mo retainer.

## Failure Modes and Recovery

| Failure | Where it shows up | Recovery |
|---|---|---|
| Gmail OAuth expired | n8n execution error in workflow 01 | Re-auth credential in n8n UI |
| OpenRouter rate limit | HTTP 429 in classifier or extractor | Built-in retry: 3x with exponential backoff |
| Sheets quota exceeded | HTTP 429 in router | Workflow re-queues with 60s delay |
| LLM returns invalid JSON | Validator catches; routes to review | Manual review or prompt tightening |
| Empty PDF text (scan) | Text-length gate before classifier | Auto-route to review with `low_text` reason |
| n8n host down | All triggers paused | Restart n8n; intake catches up via Gmail polling |
