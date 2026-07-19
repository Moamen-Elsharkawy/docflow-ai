# Workflow 05: Contract Extractor

## Purpose
Take a classified contract envelope, extract key contract fields via GPT-4o-mini, validate, route to Notion or review queue.

## Trigger
`executeWorkflowTrigger` (called by workflow 03).

## Nodes

| # | Node | Type | Purpose |
|---|---|---|---|
| 1 | Trigger | `executeWorkflowTrigger` | Receive envelope |
| 2 | Build Prompt | `set` | Inject `raw_text` into contract-extraction prompt |
| 3 | Call OpenRouter | `httpRequest` | LLM extraction |
| 4 | Parse JSON | `code` | Parse LLM output -> `extracted` |
| 5 | Validate | `code` | Run validator |
| 6 | Validation Gate | `if` | `validation.ok && extraction_confidence >= 0.8` |
| 7a | Create Notion Page | `notion` | Database from client config |
| 7b | Route to Review | `executeWorkflow` | workflow 07 |
| 8 | Telegram Success | `telegram` | "Contract processed: ..." |

## OpenRouter request
`max_tokens: 1200`. Prompt loaded from `workflows/prompts/contract-extraction.txt`.

## Validator (Code node)

```js
const env = $input.first().json;
const e = env.extracted || {};
const errors = [];

const required = ["party_a", "party_b", "contract_type", "confidence"];
for (const f of required) if (e[f] == null || e[f] === "") errors.push(`required:${f}`);

const dateFields = ["start_date", "end_date"];
for (const f of dateFields) if (e[f] && !/^\d{4}-\d{2}-\d{2}$/.test(e[f])) errors.push(`date:${f}:not_iso`);

if (e.start_date && e.end_date && e.start_date > e.end_date) errors.push("date:start_after_end");
if (Array.isArray(e.key_obligations) && e.key_obligations.length > 8) errors.push("key_obligations:too_many");

const conf = e.confidence ?? 0;
if (conf < 0.8) errors.push(`confidence:overall:${conf}`);

env.extraction_confidence = conf;
env.validation = { ok: errors.length === 0, errors };
return [{ json: env }];
```

## Notion page creation
Database ID from `client_config[client_id].destinations.contracts`. Property mapping per `docs/specs.md`. Page body: full extracted JSON in a code block + raw_text in a toggle.

## Telegram message
Contract success template per `docs/specs.md`.
