// Standalone validators - exact mirror of the n8n Code-node logic in
// n8n-exports/04-invoice-extractor.json, 05-contract-extractor.json, 06-form-extractor.json.
// Keep this file in sync if the n8n logic changes.

function validateInvoice(extracted, opts = {}) {
  const e = extracted || {};
  const errors = [];

  const required = ['vendor_name','invoice_number','invoice_date','currency','total_amount','confidence'];
  for (const f of required) if (e[f] == null || e[f] === '') errors.push('required:' + f);

  for (const f of ['invoice_date','due_date']) {
    if (e[f] && !/^\d{4}-\d{2}-\d{2}$/.test(e[f])) errors.push('date:' + f + ':not_iso');
  }

  if (e.total_amount != null && typeof e.total_amount !== 'number') errors.push('type:total_amount:expected_number');
  if (e.currency && !/^[A-Z]{3}$/.test(e.currency)) errors.push('currency:not_iso_3');

  const conf = e.confidence ?? 0;
  const minConf = opts.minConf ?? 0.8;
  if (conf < minConf) errors.push('confidence:overall:' + conf);

  if (Array.isArray(e.line_items) && e.subtotal) {
    const sum = e.line_items.reduce((a, li) => a + (Number(li.total) || 0), 0);
    if (sum > 0 && Math.abs(sum - e.subtotal) / e.subtotal > 0.05) {
      errors.push('math:line_items_vs_subtotal_diff>5%');
    }
  }

  return { ok: errors.length === 0, errors, confidence: conf };
}

function validateContract(extracted, opts = {}) {
  const e = extracted || {};
  const errors = [];

  for (const f of ['party_a','party_b','contract_type','confidence']) {
    if (e[f] == null || e[f] === '') errors.push('required:' + f);
  }
  for (const f of ['start_date','end_date']) {
    if (e[f] && !/^\d{4}-\d{2}-\d{2}$/.test(e[f])) errors.push('date:' + f + ':not_iso');
  }
  if (e.start_date && e.end_date && e.start_date > e.end_date) errors.push('date:start_after_end');
  if (Array.isArray(e.key_obligations) && e.key_obligations.length > 8) errors.push('key_obligations:too_many');

  const conf = e.confidence ?? 0;
  const minConf = opts.minConf ?? 0.8;
  if (conf < minConf) errors.push('confidence:overall:' + conf);

  return { ok: errors.length === 0, errors, confidence: conf };
}

function validateForm(extracted, fieldSpec, opts = {}) {
  const e = extracted || {};
  const fields = fieldSpec || [];
  const errors = [];

  for (const f of fields) {
    if (f.required && (e[f.name] == null || e[f.name] === '')) {
      errors.push('required:' + f.name);
      continue;
    }
    if (e[f.name] == null) continue;
    if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(e[f.name])) errors.push('date:' + f.name + ':not_iso');
    if (f.type === 'number' && typeof e[f.name] !== 'number') errors.push('type:' + f.name + ':expected_number');
    if (f.type === 'boolean' && typeof e[f.name] !== 'boolean') errors.push('type:' + f.name + ':expected_boolean');
  }

  const conf = e.confidence ?? 0;
  const minConf = opts.minConf ?? 0.8;
  if (conf < minConf) errors.push('confidence:overall:' + conf);

  return { ok: errors.length === 0, errors, confidence: conf };
}

module.exports = { validateInvoice, validateContract, validateForm };
