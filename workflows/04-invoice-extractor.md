# Workflow 04: Invoice Extractor

## Purpose
Take a classified invoice envelope, extract structured invoice fields via GPT-4o-mini, validate, route to Google Sheets or review queue.

## Trigger
`executeWorkflowTrigger` (called by workflow 03).

## Nodes

| # | Node | Type | Purpose |
|---|---|---|---|
| 1 | Trigger | `executeWorkflowTrigger` | Receive envelope |
| 2 | Build Prompt | `set` | Inject `raw_text` into invoice-extraction prompt |
| 3 | Call OpenRouter | `httpRequest` | LLM extraction |
| 4 | Parse JSON | `code` | Parse LLM output -> `extracted` |
| 5 | Validate | `code` | Run validator (see specs.md) |
| 6 | Validation Gate | `if` | `validation.ok && extraction_confidence >= 0.8` |
| 7a | Append to Sheets | `googleSheets` | invoices tab |
| 7b | Route to Review | `executeWorkflow` | workflow 07 |
| 8 | Telegram Success | `telegram` | "Invoice processed: ..." |

## OpenRouter request
Same shape as classifier, with `max_tokens: 1500` (line items can be long) and a longer prompt.

## Validator (Code node)

```js
const env = $input.first().json;
const e = env.extracted || {};
const errors = [];

const required = ["vendor_name", "invoice_number", "invoice_date", "currency", "total_amount", "confidence"];
for (const f of required) if (e[f] == null || e[f] === "") errors.push(`required:${f}`);

const dateFields = ["invoice_date", "due_date"];
for (const f of dateFields) if (e[f] && !/^\d{4}-\d{2}-\d{2}$/.test(e[f])) errors.push(`date:${f}:not_iso`);

if (typeof e.total_amount !== "number") errors.push("type:total_amount:expected_number");
if (e.currency && !/^[A-Z]{3}$/.test(e.currency)) errors.push("currency:not_iso_3");

const conf = e.confidence ?? 0;
if (conf < 0.8) errors.push(`confidence:overall:${conf}`);

// line_items math sanity
if (Array.isArray(e.line_items) && e.subtotal) {
  const sum = e.line_items.reduce((a, li) => a + (Number(li.total) || 0), 0);
  if (sum > 0 && Math.abs(sum - e.subtotal) / e.subtotal > 0.05) {
    errors.push("math:line_items_vs_subtotal_diff>5%");
  }
}

env.extraction_confidence = conf;
env.validation = { ok: errors.length === 0, errors };
return [{ json: env }];
```

## Sheets append
Spreadsheet ID + tab from `client_config[client_id].destinations.invoices`. Map fields to columns per `docs/specs.md`.

## Telegram message
Template from `docs/specs.md`. Chat ID from `client_config[client_id].telegram_chat_id`.
