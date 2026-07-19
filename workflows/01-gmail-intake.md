# Workflow 01: Gmail Intake

## Purpose
Watch a Gmail inbox (or label) for emails with PDF/DOCX attachments. Pull the attachment binary, build the envelope, hand off to the classifier (workflow 03).

## Trigger
Gmail Trigger node, polling every 1 minute. Filter: `has:attachment filename:(pdf OR docx) -in:trash`.

For per-client routing, optionally use a label per client (`docflow/<client_id>`). Same trigger, different labels.

## Nodes

| # | Node | Type | Purpose |
|---|---|---|---|
| 1 | Gmail Trigger | `gmailTrigger` | Poll inbox |
| 2 | Filter Attachments | `if` | Skip emails without supported attachments |
| 3 | Get Attachment | `gmail` (resource: message, operation: getAttachment) | Pull binary |
| 4 | Build Envelope | `set` | Construct envelope JSON |
| 5 | Extract Text | `extractFromFile` | PDF/DOCX -> text |
| 6 | Text Length Gate | `if` | If text < 50 chars, route to review |
| 7 | Call Classifier | `executeWorkflow` | Hand to workflow 03 |
| 7a | Route to Review (low text) | `executeWorkflow` | Hand to workflow 07 with reason `low_text` |

## Envelope at exit (handed to workflow 03)
```json
{
  "doc_id": "<uuid>",
  "received_at": "<iso>",
  "source": "gmail",
  "source_meta": { "email_id": "...", "email_from": "...", "filename": "..." },
  "client_id": "<from config lookup by email recipient>",
  "raw_text": "<extracted text>"
}
```

## Error handling
- OAuth expiry: n8n surfaces it; manually re-auth.
- Attachment > 10 MB: skip with Telegram alert (`large_file`).
- Multiple attachments per email: process each as separate envelope.
