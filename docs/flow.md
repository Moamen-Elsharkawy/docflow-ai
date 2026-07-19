# Flow and Architecture

## End-to-End Pipeline

```
+-----------------------------------------------------------+
|  INTAKE (3 entry points, all hand off to the classifier) |
+-----------------------------------------------------------+
| 1. Gmail trigger     - new email with PDF/DOCX attachment |
| 2. Drive trigger     - new file in monitored folder       |
| 3. Webhook (manual)  - POST a file binary for testing     |
+-----------------------------+-----------------------------+
                              |
                              v
+-----------------------------------------------------------+
|  TEXT EXTRACTION                                          |
|  - n8n "Extract from File" for PDF/DOCX                   |
|  - if extracted text length < 50 chars: scan suspected,   |
|    short-circuit to review queue with reason="low_text"   |
+-----------------------------+-----------------------------+
                              |
                              v
+-----------------------------------------------------------+
|  CLASSIFIER (LLM)                                         |
|  - GPT-4o-mini via OpenRouter                             |
|  - returns: { type, confidence, reasoning }               |
|  - if confidence < 0.7 or type == "unknown": review queue |
+-----------------------------+-----------------------------+
                              |
            +-----------------+-----------------+
            v                 v                 v
       INVOICE EXT       CONTRACT EXT       FORM EXT
       (Phase 1)         (Phase 3)          (Phase 4)
            |                 |                 |
            +--------+--------+--------+--------+
                     v                 v
+-----------------------------------------------------------+
|  VALIDATOR                                                |
|  - schema check: required fields present + correct types  |
|  - confidence gate: overall >= 0.8                        |
|  - per-field gate: critical fields >= 0.7 each            |
|  - on fail -> review queue with reason="validation:..."   |
+-----------------------------+-----------------------------+
                              |
                              v
+-----------------------------------------------------------+
|  ROUTER                                                   |
|  - invoice  -> Google Sheets (per client config)          |
|  - contract -> Notion database (per client config)        |
|  - form     -> Sheets or Notion (per client config)       |
+-----------------------------+-----------------------------+
                              |
                              v
+-----------------------------------------------------------+
|  NOTIFIER                                                 |
|  - Telegram: "Processed [type] from [vendor/party]"       |
|  - Audit log row to Supabase (Phase 2+)                   |
+-----------------------------------------------------------+
```

## Stack Decisions

| Concern | Choice | Reason |
|---|---|---|
| Orchestration | n8n self-hosted | Same as Meeting Intelligence and LeadSync. Visual debugging. Sub-workflow support. |
| LLM | GPT-4o-mini via OpenRouter | Best $/quality for structured extraction. OpenRouter gives one billing surface across models. |
| LLM transport | HTTP Request node | OpenRouter is OpenAI-compatible. Avoids depending on n8n's OpenAI node version. Easier to swap models. |
| PDF parsing | n8n built-in `extractFromFile` | Free, in-process. Scans flagged for review queue (Phase 2 adds OCR). |
| Invoice store | Google Sheets | Clients already use it. Easy review and export. |
| Contract store | Notion | Better for unstructured text and obligations as bullet lists. |
| Notifications | Telegram bot | Free, fast, mobile-first, per-client chat IDs. |
| Audit log | Supabase (Phase 2) | Free tier covers MVP volume. Standard SQL for ad-hoc queries. |

## Why Sub-Workflows

Each n8n workflow handles one concern (intake, classify, extract, route, notify). They communicate via `Execute Workflow` calls. This means:

- The same classifier serves Gmail and Drive intake without duplication.
- A bad prompt in the invoice extractor can't break Drive intake.
- Each workflow can be reimported / version-bumped independently.
- Test data can be injected at any layer via the manual webhook.

## Confidence Thresholds

| Stage | Threshold | Below threshold action |
|---|---|---|
| Text length | >= 50 chars | Review queue, reason `low_text` |
| Classifier overall | >= 0.7 | Review queue, reason `classify_low_conf` |
| Extractor overall | >= 0.8 | Review queue, reason `extract_low_conf` |
| Per-critical-field | >= 0.7 | Review queue, reason `field:<name>` |

Thresholds are config-driven via `config/client-config.json` so tighter clients can dial them up.

## Data Contract Between Workflows

Sub-workflows pass a single JSON envelope:

```json
{
  "doc_id": "uuid-v4",
  "source": "gmail" | "drive" | "manual",
  "source_meta": { "email_id": "...", "drive_file_id": "...", "filename": "..." },
  "raw_text": "string",
  "type": "invoice" | "contract" | "form" | "unknown" | null,
  "type_confidence": 0.0,
  "extracted": { ... },
  "extraction_confidence": 0.0,
  "validation": { "ok": true, "errors": [] },
  "client_id": "string"
}
```

Every workflow takes this envelope, mutates its slice, and passes it forward.
