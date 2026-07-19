# Workflow 07: Review Notifier

## Purpose
Catch-all "needs human review" path. Called by 03/04/05/06 when classification or extraction fails the confidence/validation gates. Logs the doc to a Sheets review tab and pings Telegram with details.

## Trigger
`executeWorkflowTrigger`. Called with the envelope plus a `review_reason` field.

## Inputs (envelope additions)
```json
{
  "review_reason": "low_text | classify_low_conf | classify_unknown | validation_failed | extract_low_conf | other",
  "review_details": "human-readable detail (validation errors joined, etc.)"
}
```

## Nodes

| # | Node | Type | Purpose |
|---|---|---|---|
| 1 | Trigger | `executeWorkflowTrigger` | Receive envelope |
| 2 | Build Row | `set` | Compose review_queue Sheets row |
| 3 | Append to Review Sheet | `googleSheets` | review_queue tab |
| 4 | Build Telegram Message | `set` | Compose alert text |
| 5 | Send Telegram | `telegram` | Notify owner |
| 6 | (optional) Audit Log | `httpRequest` | Insert into Supabase (Phase 2+) |

## Telegram alert template
```
Document needs review
File: {filename}
Source: {source}
Type: {type} ({type_confidence})
Reason: {review_reason}
Details: {review_details}
{drive_link or "(Gmail attachment, no link)"}
```

## Sheets review_queue row (column order)
```
doc_id | received_at | source | filename | client_id | classified_type | type_confidence | extraction_confidence | review_reason | validation_errors_json | drive_link | telegram_message_id
```

## Why one workflow instead of inline
Inline review handling in each extractor would duplicate the Sheets append, Telegram template, and audit log code in 4 places. Centralizing here means a single change (e.g., new alert format) propagates to all entry points.
