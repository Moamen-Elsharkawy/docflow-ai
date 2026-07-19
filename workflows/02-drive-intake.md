# Workflow 02: Drive Intake

## Purpose
Watch a Google Drive folder. When a new PDF/DOCX appears, download it, build the envelope, hand off to the classifier.

## Trigger
Google Drive Trigger node, "On File Created" in a specified folder ID. Polling every 1 minute.

For multi-client deployments, one trigger per client folder (or one folder per client under a root with subfolder filtering).

## Nodes

| # | Node | Type | Purpose |
|---|---|---|---|
| 1 | Drive Trigger | `googleDriveTrigger` | Watch folder |
| 2 | Filter MIME | `if` | Allow only PDF / DOCX MIME types |
| 3 | Download File | `googleDrive` (operation: download) | Pull binary |
| 4 | Build Envelope | `set` | Construct envelope JSON |
| 5 | Extract Text | `extractFromFile` | PDF/DOCX -> text |
| 6 | Text Length Gate | `if` | If text < 50 chars, route to review |
| 7 | Call Classifier | `executeWorkflow` | Hand to workflow 03 |
| 7a | Route to Review (low text) | `executeWorkflow` | Hand to workflow 07 |

## Envelope at exit
```json
{
  "doc_id": "<uuid>",
  "received_at": "<iso>",
  "source": "drive",
  "source_meta": { "drive_file_id": "...", "drive_file_link": "...", "filename": "..." },
  "client_id": "<from config lookup by folder id>",
  "raw_text": "<extracted text>"
}
```

## Error handling
- File renamed/moved during processing: capture error, retry once, then route to review.
- File MIME mismatch (e.g., .pdf with image content): text length gate catches it.
- File too large (> 25 MB): skip with `large_file` Telegram alert.
