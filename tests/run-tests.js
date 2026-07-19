// DocFlow AI test runner.
// Run: node tests/run-tests.js
// Exits 0 on all pass, 1 on any failure.

const fs = require('fs');
const path = require('path');
const { validateInvoice, validateContract, validateForm } = require('./validators');

const FIX = path.join(__dirname, 'fixtures');
const EXP = path.join(__dirname, '..', 'n8n-exports');

let passed = 0;
let failed = 0;
const failures = [];

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
}

function expectOk(label, result, expectedOk, expectedErrorContains = []) {
  const okMatch = result.ok === expectedOk;
  const allContained = expectedErrorContains.every(needle =>
    result.errors.some(err => err.includes(needle)));
  if (okMatch && allContained) {
    passed++;
    console.log('PASS  ' + label);
  } else {
    failed++;
    failures.push({ label, result, expectedOk, expectedErrorContains });
    console.log('FAIL  ' + label);
    console.log('      expected ok=' + expectedOk + ', got ok=' + result.ok);
    if (expectedErrorContains.length) {
      const missing = expectedErrorContains.filter(n => !result.errors.some(e => e.includes(n)));
      if (missing.length) console.log('      missing error fragments: ' + JSON.stringify(missing));
    }
    console.log('      actual errors: ' + JSON.stringify(result.errors));
  }
}

console.log('\n== Invoice validator ==');
expectOk('clean invoice -> ok', validateInvoice(load('invoice-clean.json')), true);
expectOk('missing vendor_name -> required:vendor_name',
  validateInvoice(load('invoice-missing-required.json')),
  false, ['required:vendor_name']);
expectOk('non-ISO invoice_date -> date:invoice_date:not_iso',
  validateInvoice(load('invoice-bad-date.json')),
  false, ['date:invoice_date:not_iso']);
expectOk('low confidence -> confidence:overall',
  validateInvoice(load('invoice-low-confidence.json')),
  false, ['confidence:overall']);
expectOk('line_items vs subtotal mismatch -> math error',
  validateInvoice(load('invoice-math-mismatch.json')),
  false, ['math:line_items_vs_subtotal_diff']);
expectOk('currency symbol only -> currency:not_iso_3',
  validateInvoice(load('invoice-bad-currency.json')),
  false, ['currency:not_iso_3']);

console.log('\n== Contract validator ==');
expectOk('clean contract -> ok', validateContract(load('contract-clean.json')), true);
expectOk('start after end -> date:start_after_end',
  validateContract(load('contract-start-after-end.json')),
  false, ['date:start_after_end']);
expectOk('too many obligations -> key_obligations:too_many',
  validateContract(load('contract-too-many-obligations.json')),
  false, ['key_obligations:too_many']);
expectOk('missing required -> required:party_b, required:contract_type',
  validateContract(load('contract-missing-required.json')),
  false, ['required:party_b', 'required:contract_type']);

console.log('\n== Form validator ==');
const spec = load('form-spec.json');
expectOk('clean form -> ok', validateForm(load('form-clean.json'), spec), true);
expectOk('type mismatches -> type errors',
  validateForm(load('form-type-mismatch.json'), spec),
  false, ['type:applicant_age:expected_number', 'date:submitted_date:not_iso', 'type:consent_given:expected_boolean']);
expectOk('missing required -> required:applicant_name, required:applicant_email',
  validateForm(load('form-missing-required.json'), spec),
  false, ['required:applicant_name', 'required:applicant_email']);

console.log('\n== n8n workflow JSON syntactic validity ==');
const expectedWorkflows = [
  '01-gmail-intake.json',
  '02-drive-intake.json',
  '03-classifier.json',
  '04-invoice-extractor.json',
  '05-contract-extractor.json',
  '06-form-extractor.json',
  '07-review-notifier.json',
  '99-manual-webhook.json'
];
for (const f of expectedWorkflows) {
  const p = path.join(EXP, f);
  try {
    const wf = JSON.parse(fs.readFileSync(p, 'utf8'));
    const hasName = typeof wf.name === 'string';
    const hasNodes = Array.isArray(wf.nodes) && wf.nodes.length > 0;
    const hasConnections = wf.connections && typeof wf.connections === 'object';
    if (hasName && hasNodes && hasConnections) {
      passed++;
      console.log('PASS  ' + f + ' is valid n8n JSON (' + wf.nodes.length + ' nodes)');
    } else {
      failed++;
      console.log('FAIL  ' + f + ' missing required top-level fields');
    }
  } catch (e) {
    failed++;
    console.log('FAIL  ' + f + ' did not parse: ' + e.message);
  }
}

console.log('\n== client-config.example.json validity ==');
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'client-config.example.json'), 'utf8'));
  const required = ['client_id','intake','doc_types_enabled','destinations','telegram','thresholds'];
  const missing = required.filter(k => !(k in cfg));
  if (missing.length === 0) {
    passed++;
    console.log('PASS  client-config.example.json has all top-level keys');
  } else {
    failed++;
    console.log('FAIL  client-config.example.json missing: ' + missing.join(', '));
  }
} catch (e) {
  failed++;
  console.log('FAIL  client-config.example.json parse: ' + e.message);
}

console.log('\n== Sub-workflow reference integrity ==');
for (const f of expectedWorkflows) {
  const p = path.join(EXP, f);
  const text = fs.readFileSync(p, 'utf8');
  const placeholders = (text.match(/REPLACE_WITH_WORKFLOW_\d+_ID/g) || []);
  const credPlaceholders = (text.match(/REPLACE_WITH_[A-Z_]+_CRED_ID/g) || []);
  const expectedSubs = {
    '01-gmail-intake.json': ['REPLACE_WITH_WORKFLOW_03_ID','REPLACE_WITH_WORKFLOW_07_ID'],
    '02-drive-intake.json': ['REPLACE_WITH_WORKFLOW_03_ID','REPLACE_WITH_WORKFLOW_07_ID'],
    '03-classifier.json':   ['REPLACE_WITH_WORKFLOW_04_ID','REPLACE_WITH_WORKFLOW_05_ID','REPLACE_WITH_WORKFLOW_06_ID','REPLACE_WITH_WORKFLOW_07_ID'],
    '04-invoice-extractor.json': ['REPLACE_WITH_WORKFLOW_07_ID'],
    '05-contract-extractor.json':['REPLACE_WITH_WORKFLOW_07_ID'],
    '06-form-extractor.json':    ['REPLACE_WITH_WORKFLOW_07_ID'],
    '07-review-notifier.json':   [],
    '99-manual-webhook.json':    ['REPLACE_WITH_WORKFLOW_03_ID','REPLACE_WITH_WORKFLOW_07_ID']
  };
  const expected = expectedSubs[f];
  const missing = expected.filter(p => !placeholders.includes(p));
  if (missing.length === 0) {
    passed++;
    console.log('PASS  ' + f + ' references: ' + (expected.length ? expected.join(', ') : '(none)') + '; cred placeholders: ' + credPlaceholders.length);
  } else {
    failed++;
    console.log('FAIL  ' + f + ' missing sub-workflow refs: ' + missing.join(', '));
  }
}

console.log('\n--------------------');
console.log('Total: ' + (passed + failed) + ' | passed: ' + passed + ' | failed: ' + failed);
process.exit(failed === 0 ? 0 : 1);
