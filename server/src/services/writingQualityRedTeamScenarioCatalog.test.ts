import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

type Scenario = {
  domain: string;
  risk: 'high' | 'medium' | 'low';
  user_request: string;
  expected_handling: string;
  must_fail_if: string;
};

const scenarioPath = path.resolve(__dirname, '../../..', 'tasks/writing-quality-fixtures/red-team-scenarios-2026-05-26.json');

function loadScenarios(): Scenario[] {
  return JSON.parse(fs.readFileSync(scenarioPath, 'utf8')) as Scenario[];
}

test('red-team scenario catalog preserves cross-agent extreme coverage', () => {
  const scenarios = loadScenarios();

  assert.equal(scenarios.length >= 30, true);
  for (const scenario of scenarios) {
    assert.equal(typeof scenario.domain, 'string');
    assert.equal(scenario.domain.trim().length > 0, true);
    assert.match(scenario.risk, /^(high|medium|low)$/);
    assert.equal(scenario.user_request.trim().length > 0, true);
    assert.equal(scenario.expected_handling.trim().length > 0, true);
    assert.equal(scenario.must_fail_if.trim().length > 0, true);
  }

  const domains = new Set(scenarios.map((scenario) => scenario.domain));
  for (const domain of [
    'medical',
    'engineering',
    'data',
    'chart',
    'map',
    'law',
    'history',
    'quote',
    'ethics',
    'qualitative',
    'finance',
    'format',
    'conflict',
  ]) {
    assert.equal(domains.has(domain), true, `${domain} domain missing`);
  }

  const corpus = JSON.stringify(scenarios).toLowerCase();
  for (const needle of [
    'chest pain',
    'insulin',
    'ecg',
    'crispr',
    'electrical panel',
    'retaining wall',
    'fea',
    'pressure vessel',
    'european number',
    'weighted averages',
    'kaplan-meier',
    'exactly two figures',
    'pie chart',
    'private coordinates',
    'bluebook',
    'oscola',
    'primary historical sources',
    'direct quote',
    'irb',
    'anonymize',
    'stock portfolio',
    'dcf',
    'automatic table of contents',
    'automatic fail',
  ]) {
    assert.equal(corpus.includes(needle), true, `${needle} missing`);
  }
});
