# Workflow 03: Classifier

## Purpose
Take the envelope (with raw_text), call GPT-4o-mini via OpenRouter to classify the document, then route to the correct extractor sub-workflow.

## Trigger
`executeWorkflowTrigger` (called by 01 / 02 / manual webhook).

## Nodes

| # | Node | Type | Purpose |
|---|---|---|---|
| 1 | Trigger | `executeWorkflowTrigger` | Receive envelope |
| 2 | Build Prompt | `set` | Inject `raw_text` into classifier prompt |
| 3 | Call OpenRouter | `httpRequest` | POST to `/api/v1/chat/completions` |
| 4 | Parse Response | `code` | Parse JSON from LLM response, attach to envelope |
| 5 | Confidence Gate | `if` | type_confidence >= 0.7 AND type != "unknown"? |
| 6a | Type Switch | `switch` | Route by `type` |
| 6b | Route to Review (low conf or unknown) | `executeWorkflow` | Workflow 07 |
| 7a | Call Invoice Extractor | `executeWorkflow` | Workflow 04 |
| 7b | Call Contract Extractor | `executeWorkflow` | Workflow 05 |
| 7c | Call Form Extractor | `executeWorkflow` | Workflow 06 |

## OpenRouter Request

```json
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer {{ $credentials.openrouter.apiKey }}
Content-Type: application/json

{
  "model": "openai/gpt-4o-mini",
  "messages": [
    { "role": "system", "content": "<system part of prompt file>" },
    { "role": "user", "content": "<user part with raw_text>" }
  ],
  "response_format": { "type": "json_object" },
  "temperature": 0.1,
  "max_tokens": 200
}
```

## Parse Response (Code node, JS)

```js
const choice = $input.first().json.choices[0].message.content;
let parsed;
try { parsed = JSON.parse(choice); }
catch (e) {
  parsed = { type: "unknown", confidence: 0.0, reasoning: "json_parse_error" };
}
const env = $input.first().json.envelope ?? $input.first().json;
return [{ json: { ...env, type: parsed.type, type_confidence: parsed.confidence, type_reasoning: parsed.reasoning } }];
```

## Confidence rule
- type_confidence >= 0.7 AND type in {invoice, contract, form} -> proceed
- otherwise -> review queue with reason `classify_low_conf` or `classify_unknown`
