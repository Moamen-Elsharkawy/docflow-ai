# Workflow 06: Form Extractor

## Purpose
Generic form extractor. Takes a per-client field list from the envelope's `client_id` config and extracts only those fields. Routes to Sheets or Notion based on client config.

## Trigger
`executeWorkflowTrigger` (called by workflow 03).

## Nodes

| # | Node | Type | Purpose |
|---|---|---|---|
| 1 | Trigger | `executeWorkflowTrigger` | Receive envelope |
| 2 | Lookup Client Form Spec | `code` | Read `client_config[client_id].forms.fields` |
| 3 | Build Prompt | `set` | Inject `raw_text` + field list into form-extraction prompt |
| 4 | Call OpenRouter | `httpRequest` | LLM extraction |
| 5 | Parse JSON | `code` | Parse LLM output -> `extracted` |
| 6 | Validate | `code` | Run validator with dynamic schema |
| 7 | Validation Gate | `if` | `validation.ok && extraction_confidence >= 0.8` |
| 8a | Route by Destination | `switch` | sheets / notion |
| 8b | Route to Review | `executeWorkflow` | workflow 07 |
| 9a | Append to Sheets | `googleSheets` | dynamic columns from field list |
| 9b | Create Notion Page | `notion` | dynamic properties from field list |
| 10 | Telegram Success | `telegram` | "Form processed: ..." |

## Dynamic validator (Code node)

```js
const env = $input.first().json;
const e = env.extracted || {};
const fields = env.form_field_spec || [];   // [{name, type, required}]
const errors = [];

for (const f of fields) {
  if (f.required && (e[f.name] == null || e[f.name] === "")) {
    errors.push(`required:${f.name}`);
    continue;
  }
  if (e[f.name] == null) continue;
  if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(e[f.name])) errors.push(`date:${f.name}:not_iso`);
  if (f.type === "number" && typeof e[f.name] !== "number") errors.push(`type:${f.name}:expected_number`);
  if (f.type === "boolean" && typeof e[f.name] !== "boolean") errors.push(`type:${f.name}:expected_boolean`);
}

const conf = e.confidence ?? 0;
if (conf < 0.8) errors.push(`confidence:overall:${conf}`);

env.extraction_confidence = conf;
env.validation = { ok: errors.length === 0, errors };
return [{ json: env }];
```

## Routing destination
- `client_config[client_id].forms.destination.kind` is `sheets` or `notion`
- For sheets: append a row, columns named after fields
- For notion: create a page, properties named after fields (text/number/checkbox/date)
