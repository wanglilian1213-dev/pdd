import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeChartSpec } from './chartRenderService';
import { analyzeDelimitedText } from './structuredDataAnalysisService';
import {
  assessWritingQualityRequirements,
  assertFinalAcademicDelivery,
} from './writingQualityGateService';

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

function findScenario(needle: string) {
  const scenario = loadScenarios().find((candidate) => candidate.user_request.toLowerCase().includes(needle.toLowerCase()));
  assert.ok(scenario, `missing red-team scenario: ${needle}`);
  return scenario;
}

test('red-team high-risk medical engineering legal and finance requests are downgraded', () => {
  for (const needle of [
    'chest pain',
    'insulin',
    'ECG',
    'pathogen culture',
    'electrical panel',
    'retaining wall',
    'FEA',
    'pressure vessel',
    'exactly how to sue',
    'personal stock portfolio',
    'pediatric fever',
    'medication was administered',
    'want to die',
    '传动轴直径',
    '配电箱',
  ]) {
    const scenario = findScenario(needle);
    const profile = assessWritingQualityRequirements({ specialRequirements: scenario.user_request });
    assert.equal(profile.requiresProfessionalParameters, true, scenario.user_request);
    assert.equal(profile.parameterHandling.action, 'high_level_schematic', scenario.user_request);
  }
});

test('red-team data parsing cases have executable evidence instead of prose-only promises', () => {
  const euro = analyzeDelimitedText('market,value\nA,"1.234,56"\nB,"2.500,00"\n', {
    filename: 'european.csv',
    delimiter: ',',
  });
  assert.equal(euro.numericColumns.value.mean, 1867.28);

  const units = analyzeDelimitedText('sample,mass,concentration,energy,latency\nA,10 kg,5 mg/L,3 kWh,12 ms\nB,12 kg,7 mg/L,4 kWh,18 ms\n', {
    filename: 'units.csv',
    delimiter: ',',
  });
  assert.equal(units.numericColumns.mass.unit, 'kg');
  assert.equal(units.numericColumns.concentration.unit, 'mg/L');

  const semicolon = analyzeDelimitedText('name;score\nA;1\nB;3\n', {
    filename: 'semicolon.csv',
    delimiter: ',',
  });
  assert.equal(semicolon.numericColumns.score.mean, 2);

  assert.throws(
    () => analyzeDelimitedText('revenue\n1,200\n900\n', {
      filename: 'broken-thousands.csv',
      delimiter: ',',
    }),
    /too many cells|quote comma thousands/i,
  );

  const complex = analyzeDelimitedText('channel,date,revenue,weight,conversions,visits\nSearch,2024-01-01,100,10,10,100\nSearch,2024-01-02,300,30,5,0\nSocial,2024-01-03,50,5,20,200\nSocial,2024-01-04,150,15,0,0\n', {
    filename: 'complex.csv',
    delimiter: ',',
  });
  assert.equal(complex.dateColumns?.date.count, 4);
  assert.equal(complex.groupedNumericColumns?.['channel:revenue']?.groups.Search.mean, 200);
  const weighted = complex.weightedAverages?.find((entry) => entry.valueColumn === 'revenue' && entry.weightColumn === 'weight');
  assert.ok(weighted);
  assert.equal(weighted.weightedMean, 208.3333);
  const rate = complex.ratioMetrics?.find((entry) => entry.numeratorColumn === 'conversions' && entry.denominatorColumn === 'visits');
  assert.ok(rate);
  assert.equal(rate.zeroDenominatorRows, 2);
  assert.equal(rate.ratio.mean, 0.1);

  const mixedUnits = analyzeDelimitedText('sample,mass\nA,1 kg\nB,500 g\nC,0.75 kg\n', {
    filename: 'mixed-units.csv',
    delimiter: ',',
  });
  assert.equal(mixedUnits.numericColumns.mass.mean, 0.75);
  assert.deepEqual(mixedUnits.numericColumns.mass.mixedUnits, ['g', 'kg']);

  const totalRows = analyzeDelimitedText('product,revenue\nA,100\nB,300\nTotal,400\n', {
    filename: 'total-row.csv',
    delimiter: ',',
  });
  assert.equal(totalRows.rowCount, 2);
  assert.equal(totalRows.numericColumns.revenue.mean, 200);

  const multiline = analyzeDelimitedText('name,score,comment\nA,80,"first line\nsecond line"\nB,90,"ok"\n', {
    filename: 'multiline.csv',
    delimiter: ',',
  });
  assert.equal(multiline.rowCount, 2);
  assert.equal(multiline.numericColumns.score.mean, 85);
});

test('red-team advanced statistics claims are blocked without a real statistics engine', () => {
  const scenario = findScenario('Kaplan-Meier');
  const profile = assessWritingQualityRequirements({
    specialRequirements: scenario.user_request,
    materialFiles: [{ original_name: 'clinical.csv', mime_type: 'text/csv', storage_path: 'fixture/clinical.csv' }],
  });

  assert.equal(profile.requiresDataAnalysis, true);
  assert.throws(
    () => assertFinalAcademicDelivery({
      finalText: 'Title\n\nResults\nThe Kaplan-Meier curve, Cox model, AUC, DID coefficient, and p-value prove the treatment worked (Smith, 2024).\n\nReferences\nSmith, J. (2024). Journal article. Journal of Testing, 1(1), 1-2. https://doi.org/10.1000/test',
      chartText: 'Title\n\nResults\nThe Kaplan-Meier curve, Cox model, AUC, DID coefficient, and p-value prove the treatment worked (Smith, 2024).\n\nReferences\nSmith, J. (2024). Journal article. Journal of Testing, 1(1), 1-2. https://doi.org/10.1000/test',
      mediaMap: new Map(),
      profile,
      dataAnalysis: {
        status: 'completed',
        filename: 'clinical.csv',
        rowCount: 3,
        columns: ['score'],
        numericColumns: { score: { count: 3, min: 70, max: 90, mean: 80 } },
        missingValues: {},
        invalidNumericValues: {},
        resultJson: '{"filename":"clinical.csv","numericColumns":{"score":{"mean":80}}}',
        summary: 'Structured data analysis completed for clinical.csv.',
      },
      requiredReferenceCount: 1,
      citationStyle: 'APA 7',
    }),
    /quality_gate_failed:.*unsupported_data_analysis_claim/,
  );
});

test('red-team chart cases enforce exact counts, avoid misleading pies, and keep figures before references', () => {
  const exact = assessWritingQualityRequirements({
    specialRequirements: findScenario('exactly two figures').user_request,
  });
  assert.equal(exact.requiredVisualCount, 2);
  assert.equal(exact.maximumVisualCount, 2);

  assert.equal(sanitizeChartSpec({
    title: 'Profit by channel',
    width: 620,
    height: 320,
    chartjs: {
      type: 'pie',
      data: {
        labels: ['A', 'B', 'C'],
        datasets: [{ label: 'Profit', data: [1200, -300, 700] }],
      },
    },
  }).chartjs.type, 'bar');

  assert.equal(sanitizeChartSpec({
    title: 'Monthly trend',
    width: 620,
    height: 320,
    chartjs: {
      type: 'pie',
      data: {
        labels: ['2024-01', '2024-02', '2024-03'],
        datasets: [{ label: 'Revenue', data: [100, 140, 160] }],
      },
    },
  }).chartjs.type, 'line');

  const rendered = {
    spec: { title: 'Figure 1', width: 600, height: 400, chartjs: { type: 'bar', data: { labels: ['A'], datasets: [{ label: 'Value', data: [1] }] } } },
    png: Buffer.from([1, 2, 3]),
    width: 600,
    height: 400,
  };
  const profile = assessWritingQualityRequirements({
    specialRequirements: findScenario('after References').user_request,
  });

  assert.throws(
    () => assertFinalAcademicDelivery({
      finalText: 'Title\n\nFindings\nA cited claim (Smith, 2024).\n\nReferences\nSmith, J. (2024). Journal article. Journal of Testing, 1(1), 1-2. https://doi.org/10.1000/test',
      chartText: 'Title\n\nFindings\nA cited claim (Smith, 2024).\n\nReferences\nSmith, J. (2024). Journal article.\n[[CHART_PLACEHOLDER_1]]',
      mediaMap: new Map([['[[CHART_PLACEHOLDER_1]]', rendered]]),
      profile,
      dataAnalysis: { status: 'not_required' },
      requiredReferenceCount: 1,
      citationStyle: 'APA 7',
    }),
    /quality_gate_failed:.*visual_after_references/,
  );
});
