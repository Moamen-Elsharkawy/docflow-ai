# Build Phases, Demo Script, Pricing

## Phase 1: Invoice Pipeline (MVP, ship first)

**Goal:** A real invoice mailed to the monitored Gmail inbox lands as a Sheets row plus a Telegram confirmation in under 60 seconds.

### Steps

1. Set up Gmail intake workflow (01) and confirm it picks up attachments.
2. Set up text extraction with the "Extract from File" node.
3. Build classifier workflow (03) and tune the prompt against 5-10 real invoices + 2-3 non-invoices.
4. Build invoice extractor (04) and tune the prompt against the same 5-10 invoices.
5. Build the validator Code node inside (04). Confirm it catches missing fields and bad dates.
6. Wire up Sheets output with the columns from `specs.md`.
7. Wire up Telegram success message.
8. Wire up review queue notifier (07) for low-confidence cases.
9. End-to-end test: send 3 real invoices, verify all 3 land correctly.

**Definition of done:** 3 consecutive real invoices processed correctly end-to-end with no manual intervention.

## Phase 2: Drive Intake + Audit Log

1. Add Drive folder watcher (02) as a second intake path.
2. Stand up Supabase project, create `audit_log` table.
3. Add an audit row insert at the end of every successful run AND every review-queue route.
4. Add a "needs review" tab to the Sheets output for the review queue.
5. Build a tiny Notion or Sheets dashboard reading from Supabase: docs/day, success rate, avg confidence.

`audit_log` schema:
```sql
CREATE TABLE audit_log (
  doc_id UUID PRIMARY KEY,
  client_id TEXT NOT NULL,
  source TEXT NOT NULL,
  filename TEXT,
  type TEXT,
  type_confidence NUMERIC,
  extraction_confidence NUMERIC,
  status TEXT NOT NULL,           -- 'logged' | 'review'
  errors TEXT[],
  destination TEXT,
  destination_id TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON audit_log (client_id, received_at DESC);
CREATE INDEX ON audit_log (status) WHERE status = 'review';
```

## Phase 3: Contract Extractor

1. Build contract extraction prompt (`workflows/prompts/contract-extraction.txt`).
2. Tune it against 5+ real contracts (NDA, service agreement, lease).
3. Set up Notion database with the schema in `specs.md`.
4. Build contract extractor workflow (05).
5. Wire classifier branch -> contract extractor -> Notion.
6. End-to-end test: drop a contract PDF in the Drive folder, watch it land in Notion.

## Phase 4: Form Extractor + Multi-Client Config

1. Build generic form extractor (06) that takes field list from envelope.
2. Externalize all per-client values to `config/client-config.<client_id>.json`.
3. Add a client lookup at the start of workflow 03 so the envelope carries `client_id`.
4. Onboard the second client without touching workflow JSON. Only config changes.
5. Build the onboarding checklist (lives in `setup.md`).

## Demo Script (15 minutes for prospects)

**Setup before the call:**
- Pre-load 3 sample documents: 1 clean invoice, 1 messy invoice (handwriting on top), 1 random non-invoice.
- Have the Sheets, the Telegram chat, and the n8n execution view all open in tabs.

**Demo flow:**

1. **(2 min) The pain.** "Walk me through how you handle a supplier invoice today." Let them tell you. Reflect back the time cost: "So that's roughly X hours/week."

2. **(3 min) The pitch.** "Here's a system I built that ingests documents from your inbox, extracts the data, and logs it. I want to show you it running on real invoices."

3. **(5 min) Live demo.**
   - Email the clean invoice to the monitored inbox. While it processes, talk through the architecture in one sentence per stage.
   - Show the Telegram ping.
   - Show the new Sheets row.
   - Now email the messy invoice. Show the review queue notification. Frame this as a feature: "It never silently drops anything. If it's unsure, you see it."

4. **(2 min) The economics.** "Setup is $400-700 depending on doc types. Then $75-150/month for prompt updates and new doc types. At your volume, payback is X weeks."

5. **(3 min) The ask.** "Want me to set this up for one document type as a pilot? Two-week trial. If it doesn't save your team time, you don't pay the retainer."

## Pricing

| Component | Range | Trigger |
|---|---|---|
| Setup (1 doc type, 1 destination) | $400 | Single client, invoice-only |
| Setup (2 doc types) | $550 | Add contracts or forms |
| Setup (3 doc types + audit log) | $700 | Full system |
| Monthly retainer | $75-150/mo | Prompt updates, new edge cases, occasional new doc types |
| Add a new doc type to existing client | $150 one-off | After initial setup |

Discount lever: if they commit to a 6-month retainer up front, knock 20% off setup.

## First-Target Clients

Existing relationships only for the first deployment. Cold outreach starts after one paying client and one confirmed time-saved testimonial.

Candidates (in order of likelihood):
1. **Restaurant** - supplier invoices, highest volume, simplest schema. Best Phase 1 fit.
2. **Real estate agency** - property contracts, harder schema but high per-doc value.
3. **Physio clinic** - insurance forms, requires form extractor (Phase 4) before deploying.

## Post-Deployment Metrics (track for case study)

- Documents/week processed
- Hours/week saved (ask client to estimate)
- Review queue rate (% of docs needing manual review)
- Average extraction confidence
- Cost per document in LLM spend

After 2 weeks: case study format goes into `references/examples/`.
