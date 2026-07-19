# Specs: Schemas, Validation, Output Formats

## Envelope (passed between every sub-workflow)

```json
{
  "doc_id": "string (uuid v4)",
  "received_at": "ISO 8601 timestamp",
  "source": "gmail | drive | manual",
  "source_meta": {
    "email_id": "string|null",
    "email_from": "string|null",
    "drive_file_id": "string|null",
    "drive_file_link": "string|null",
    "filename": "string"
  },
  "client_id": "string",
  "raw_text": "string",
  "type": "invoice | contract | form | unknown | null",
  "type_confidence": "number 0..1",
  "extracted": "object | null",
  "extraction_confidence": "number 0..1",
  "validation": {
    "ok": "boolean",
    "errors": ["string array"]
  },
  "destination": {
    "kind": "sheets | notion | review",
    "id": "string"
  }
}
```

## Invoice Schema

```json
{
  "vendor_name": "string (required)",
  "vendor_tax_id": "string | null",
  "invoice_number": "string (required)",
  "invoice_date": "YYYY-MM-DD (required)",
  "due_date": "YYYY-MM-DD | null",
  "currency": "string, 3-letter ISO (required)",
  "subtotal": "number | null",
  "tax_amount": "number | null",
  "tax_rate": "number | null",
  "total_amount": "number (required)",
  "line_items": [
    {
      "description": "string",
      "qty": "number",
      "unit_price": "number",
      "total": "number"
    }
  ],
  "payment_terms": "string | null",
  "notes": "string | null",
  "confidence": "number 0..1 (required)"
}
```

**Required fields:** `vendor_name`, `invoice_number`, `invoice_date`, `currency`, `total_amount`, `confidence`.

**Critical fields (per-field >= 0.7):** `vendor_name`, `invoice_number`, `total_amount`.

## Contract Schema

```json
{
  "party_a": "string (required)",
  "party_b": "string (required)",
  "contract_type": "string (required)",
  "start_date": "YYYY-MM-DD | null",
  "end_date": "YYYY-MM-DD | null",
  "auto_renew": "boolean | null",
  "key_obligations": ["string array"],
  "payment_terms": "string | null",
  "termination_clause_summary": "string | null",
  "governing_law": "string | null",
  "signed": "boolean | null",
  "confidence": "number 0..1 (required)"
}
```

**Required fields:** `party_a`, `party_b`, `contract_type`, `confidence`.

**Critical fields:** `party_a`, `party_b`, `contract_type`.

## Form Schema

Form schema is dynamic. Each client config declares the fields. Example:

```json
{
  "applicant_name": "string",
  "applicant_email": "string",
  "applicant_phone": "string",
  "submitted_date": "YYYY-MM-DD",
  "<custom_field_1>": "string|number|boolean",
  "confidence": "number 0..1"
}
```

The form extractor receives the field list from the envelope's `client_id` lookup and tells the LLM exactly which fields to extract. Always include `confidence`.

## Validator Rules

The validator is one Code node per extractor. Same logic, different schema. Pseudocode:

```js
function validate(extracted, schema) {
  const errors = [];

  // 1. required fields present and non-null
  for (const f of schema.required) {
    if (extracted[f] == null || extracted[f] === "") {
      errors.push(`required:${f}`);
    }
  }

  // 2. type checks
  for (const [field, type] of Object.entries(schema.types)) {
    if (extracted[field] == null) continue;
    if (!checkType(extracted[field], type)) {
      errors.push(`type:${field}:expected_${type}`);
    }
  }

  // 3. date formats (ISO 8601)
  for (const f of schema.dateFields) {
    if (extracted[f] && !/^\d{4}-\d{2}-\d{2}$/.test(extracted[f])) {
      errors.push(`date:${f}:not_iso`);
    }
  }

  // 4. number sanity (no negatives where they shouldn't be)
  for (const f of schema.positiveNumbers) {
    if (typeof extracted[f] === "number" && extracted[f] < 0) {
      errors.push(`negative:${f}`);
    }
  }

  // 5. overall confidence gate
  if ((extracted.confidence ?? 0) < schema.minOverallConfidence) {
    errors.push(`confidence:overall:${extracted.confidence}`);
  }

  // 6. invoice-specific: line items math sanity
  if (schema.kind === "invoice" && Array.isArray(extracted.line_items)) {
    const sum = extracted.line_items.reduce((a, li) => a + (li.total || 0), 0);
    if (sum > 0 && extracted.subtotal && Math.abs(sum - extracted.subtotal) / extracted.subtotal > 0.05) {
      errors.push("math:line_items_vs_subtotal_diff>5%");
    }
  }

  return { ok: errors.length === 0, errors };
}
```

## Sheets Output Format (Invoice)

Tab name: `invoices`. Header row (row 1):

```
doc_id | received_at | source | filename | vendor_name | invoice_number | invoice_date | due_date | currency | subtotal | tax_amount | total_amount | line_items_json | payment_terms | extraction_confidence | drive_link
```

`line_items_json` is the line items array stringified into a single cell.

Tab name: `review_queue`. Header row:

```
doc_id | received_at | source | filename | classified_type | type_confidence | extraction_confidence | validation_errors | drive_link | telegram_message_id
```

## Notion Output Format (Contract)

Database properties:

| Property | Type | Source |
|---|---|---|
| Title (Party A vs Party B) | Title | computed |
| Party A | Rich text | extracted.party_a |
| Party B | Rich text | extracted.party_b |
| Contract Type | Select | extracted.contract_type |
| Start Date | Date | extracted.start_date |
| End Date | Date | extracted.end_date |
| Signed | Checkbox | extracted.signed |
| Key Obligations | Rich text | extracted.key_obligations.join("\n") |
| Termination | Rich text | extracted.termination_clause_summary |
| Source | URL | source_meta.drive_file_link |
| Confidence | Number | extraction_confidence |
| Status | Select | "Active" / "Review" |

The page body gets the full extracted JSON in a code block plus the raw extracted text in a toggle.

## Telegram Message Templates

**Success (invoice):**
```
Invoice processed
Vendor: {vendor_name}
Number: {invoice_number}
Total: {currency} {total_amount}
Logged to Sheets: {row_link}
```

**Success (contract):**
```
Contract processed
Parties: {party_a} <-> {party_b}
Type: {contract_type}
Logged to Notion: {page_link}
```

**Review needed:**
```
Document needs review
File: {filename}
Type guess: {type} ({type_confidence})
Reasons: {validation_errors_joined}
File: {drive_link}
```
