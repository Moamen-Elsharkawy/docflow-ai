# Document Types: Rules, Edge Cases, Examples

## Invoice

### What counts as an invoice
- Supplier bills (B2B)
- Customer-facing receipts
- Purchase orders (treat as invoices for now; client may want a separate type later)
- Credit notes (negative totals; preserve sign)
- Pro-forma invoices (mark `notes: "pro-forma"` so client knows it's not yet payable)

### Common edge cases

| Case | Handling |
|---|---|
| Multi-page invoice | Concatenate text from all pages before sending to LLM |
| Multiple invoices in one PDF | Detect via "Invoice #" pattern repeating; if confidence drops, route to review |
| Currency symbol but no ISO code | Map common symbols ($ -> USD/EGP based on `client_config.default_currency`, GBP, EUR) |
| Tax included in line items vs. separate | LLM extracts what's stated; validator does NOT recompute, only sanity-checks |
| No invoice number printed | If vendor + date + total present, generate `vendor_<date>_<total>` as a synthetic key. Log warning. |
| Date in non-ISO format (15/03/2026 vs 03/15/2026) | LLM normalizes to ISO 8601 in the prompt; validator rejects non-ISO output |
| Handwritten amounts on a printed template | Likely a scan; text extraction will be partial. Route to review. |
| Languages: Arabic, mixed Arabic/English | Prompt includes "Documents may be in English or Arabic." |
| Discounts as line items | Extract as a line item with negative `total`. Validator allows negatives in line items. |

### Sample text fixtures

See `tests/fixtures/invoice-*.txt` for redacted real-world samples. Each has a paired `.expected.json` with the gold extraction.

## Contract

### What counts as a contract
- Service agreements
- NDAs
- Employment contracts (use sparingly; sensitive data, flag with client first)
- Leases
- Vendor agreements

### Common edge cases

| Case | Handling |
|---|---|
| Auto-renew clauses | Set `auto_renew: true` and add the renewal terms to `key_obligations` |
| No explicit end date | `end_date: null`, add note in `termination_clause_summary` |
| Multiple parties (more than 2) | `party_a` = primary, `party_b` = "and N others (see body)"; full list in Notion page body |
| Amendments to existing contracts | Treat as a new contract; prefix `contract_type` with "Amendment to: " |
| Signed via DocuSign metadata | `signed: true` and add note about e-signature |
| Page is a signature page only | Low confidence; route to review |
| Governing law not stated | `governing_law: null` |

## Form

### What counts as a form
- Application forms (job, service signup)
- Intake forms (medical, legal)
- Insurance claim forms
- Registration forms

### Why forms are different
Schema is per-client. The form extractor takes a list of field names + types from `client_config.json` and prompts the LLM to extract exactly those. Anything not in the list is dropped.

### Common edge cases

| Case | Handling |
|---|---|
| Multi-section form (page 1 personal, page 2 medical history) | Pass full text; LLM extracts across sections |
| Checkboxes | Render as boolean fields in the schema |
| Free-text answers next to a label | Extract the answer text; no length cap |
| Skipped/blank fields | `null` in output (not empty string) |
| Form template with no answers filled in | Confidence will be low; route to review |
| Signature image with no typed name | Set `signed: true`, `signed_by_name: null` |

## Type Boundaries (when classifier is uncertain)

| Looks like | Reality | How to disambiguate |
|---|---|---|
| Invoice with contract-style language | Invoice (a "this serves as an agreement that you owe X" wrapper is still an invoice) | If a total amount + line items present, it's an invoice |
| Service agreement with a fee schedule appendix | Contract | If parties + start/end dates are primary, contract |
| Insurance claim form | Form | If it has labeled fields that can be filled, form |
| Receipt | Invoice | Receipts use the invoice schema; treat amounts as already paid |
| Statement of account | Unknown (ambiguous between invoice and audit doc) | Route to review for now; add "statement" as a 4th type if volume is high |

## Language Handling

- Default: English.
- Arabic and mixed Arabic/English are supported by GPT-4o-mini natively.
- Right-to-left text in PDFs sometimes extracts in reversed order. If extraction quality is poor, the prompt instructs the LLM to "if the text appears reversed, reorder it before extracting."
- Do not translate field values. Keep `vendor_name` in its source language. The Sheets row shows the original.

## When to add a new document type

Add a new type when:
- Same client repeatedly sends the same kind of doc that doesn't fit invoice / contract / form.
- The volume justifies a new prompt + schema (more than 10/month).

Do NOT add a new type for one-offs. Route those to review and let the human handle.

The recipe to add a type:
1. Create `workflows/prompts/<type>-extraction.txt`.
2. Add the schema to `docs/specs.md`.
3. Build a new extractor workflow (`08-<type>-extractor.json`) modeled on the invoice extractor.
4. Add the type to the classifier prompt's allowed values.
5. Add a routing branch in workflow 03.
6. Update validator with the new schema.
7. Tune against 5+ samples.
