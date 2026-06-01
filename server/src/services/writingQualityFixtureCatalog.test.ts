import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

type Fixture = {
  id: string;
  category: string;
  user_request: string;
  materials: string[];
  expected_behavior: string[];
  must_fail_if: string[];
  evidence_required: string[];
  [key: string]: unknown;
};

const fixturePath = path.resolve(__dirname, '../../..', 'tasks/writing-quality-fixtures/fixed-fixtures.json');

function loadFixtures(): Fixture[] {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as Fixture[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

test('fixed writing-quality fixture catalog is a complete 110-card checklist', () => {
  const fixtures = loadFixtures();

  assert.equal(fixtures.length, 110);

  const seen = new Set<string>();
  fixtures.forEach((fixture, index) => {
    const expectedId = `WQ-${String(index + 1).padStart(3, '0')}`;
    assert.equal(fixture.id, expectedId);
    assert.equal(seen.has(fixture.id), false, `duplicate fixture id ${fixture.id}`);
    seen.add(fixture.id);

    assert.equal(typeof fixture.category, 'string');
    assert.equal(fixture.category.trim().length > 0, true);
    assert.equal(typeof fixture.user_request, 'string');
    assert.equal(fixture.user_request.trim().length > 0, true);
    assert.equal(isStringArray(fixture.materials), true, `${fixture.id} materials must be a non-empty string array`);
    assert.equal(isStringArray(fixture.expected_behavior), true, `${fixture.id} expected_behavior must be a non-empty string array`);
    assert.equal(isStringArray(fixture.must_fail_if), true, `${fixture.id} must_fail_if must be a non-empty string array`);
    assert.equal(isStringArray(fixture.evidence_required), true, `${fixture.id} evidence_required must be a non-empty string array`);
  });
});

test('fixed writing-quality fixtures cover every high-risk pindaidai workflow area', () => {
  const categories = new Set(loadFixtures().map((fixture) => fixture.category));
  const requiredCategoryPrefixes = [
    'normal_',
    'assignment_',
    'citation_',
    'prompt_injection_',
    'data_',
    'chart_',
    'flowchart_',
    'medical_',
    'engineering_',
    'format_',
    'delivery_',
    'rerun_',
    'ai_detection_',
    'humanize_',
    'revision_',
    'scoring_',
    'privacy_',
    'source_',
    'legal_',
    'finance_',
    'chemistry_',
    'math_',
    'formula_',
    'cs_',
    'qualitative_',
    'ethics_',
    'gis_',
    'image_',
    'file_',
    'multilingual_',
    'accessibility_',
    'timeline_',
    'combined_',
  ];

  const missingPrefixes = requiredCategoryPrefixes.filter((prefix) => (
    !Array.from(categories).some((category) => category.startsWith(prefix))
  ));

  assert.deepEqual(missingPrefixes, []);
});

test('fixed writing-quality fixtures preserve cross-agent edge-case coverage', () => {
  const corpus = JSON.stringify(loadFixtures()).toLowerCase();
  const requiredNeedles = [
    'rubric weight sum must be 100',
    'no padded weakness',
    'user says no references but assignment brief requires references',
    'appendix a must contain data cleaning notes',
    'source does not support claim',
    'fabricated doi',
    'no internet but user requests latest data',
    'nested json user.city',
    'formula values',
    'empty sales cell is not zero',
    'zero division conversion rate flagged',
    'outlier value 10000',
    'date parsing multiple formats',
    'mixed number formats $1,200 900元 1.5k',
    '80 sku chart',
    'chinese font/render blank boxes',
    'render failure gives text summary',
    'pie chart requested for trend',
    'pediatric acetaminophen ibuprofen exact dose',
    'vancomycin renal dosing',
    'insulin pump setting change',
    'morphine iv dose',
    'chest pain triage flowchart',
    'stroke sop',
    'icu ventilator weaning',
    'aortic dissection back pain',
    'balcony fish tank 1200kg',
    'temporary 3 ton lifting steel beam',
    'load-bearing wall',
    'c30 concrete 7 day strength',
    'hrb400 parameters require standard version',
    'material report screenshot',
    'crane limit switch failure',
    'deep excavation cracks',
    'json-only output mode',
    'file role misclassification',
    'article-only scoring',
    'oscola',
    'guaranteed return',
    'hazardous synthesis',
    'bypass authentication',
    'participant names',
    'irb approval',
    'exact coordinates',
    'blurry screenshot',
    'corrupted pdf',
    'spanish and chinese source materials',
    'relative dates converted to exact dates',
    'latest tax policy',
    'chicago notes-bibliography',
    'times new roman 12',
    'automatic table of contents',
    'slide number',
    'turnitin ai 0%',
    'automatic fail',
    'caps the maximum score at 60',
    'block quotes',
    'key chinese legal and policy terms',
  ];

  const missingNeedles = requiredNeedles.filter((needle) => !corpus.includes(needle.toLowerCase()));
  assert.deepEqual(missingNeedles, []);
});

test('fixed writing-quality fixtures include evidence hooks for automated and online verification', () => {
  const fixtures = loadFixtures();

  assert.ok(fixtures.some((fixture) => 'standard_data_result' in fixture), 'data fixtures need standard results');
  assert.ok(fixtures.some((fixture) => 'chart_expectation' in fixture), 'chart fixtures need chart expectations');
  assert.ok(fixtures.some((fixture) => 'parameter_rule' in fixture), 'medical/engineering fixtures need parameter rules');
  assert.ok(fixtures.some((fixture) => 'rubric_or_citation_expectation' in fixture), 'citation/rubric fixtures need explicit expectations');

  const highRiskFixtures = fixtures.filter((fixture) => (
    /data|chart|medical|engineering|rubric|citation|prompt_injection|privacy|source|combined/.test(fixture.category)
  ));

  const missingEvidence = highRiskFixtures
    .filter((fixture) => !isStringArray(fixture.evidence_required))
    .map((fixture) => fixture.id);

  assert.deepEqual(missingEvidence, []);
});
