import test from 'node:test';
import assert from 'node:assert/strict';
import { renderChart, sanitizeChartSpec, type ChartSpec } from './chartRenderService';

test('sanitizeChartSpec converts invalid chart specs into a safe renderable shape', () => {
  const spec = sanitizeChartSpec({
    title: '',
    width: Number.NaN,
    height: Number.NaN,
    chartjs: {
      type: 'custom-script',
      data: {
        labels: ['A', null, 'B'],
        datasets: [
          {
            label: 'Scores',
            data: [1, '2', 'not-a-number', { x: 4, y: 5, r: 6 }],
            backgroundColor: ['#111', { unsafe: true }, '#222'],
            borderColor: '#333',
            fill: true,
            callback: 'function () { return process.env.OPENAI_API_KEY }',
          },
        ],
      },
      options: {
        plugins: {
          title: {
            text: 'Survey result',
            callback: 'function () { return "unsafe" }',
          },
          legend: { display: true },
          tooltip: {
            callbacks: {
              label: 'function () { return "unsafe" }',
            },
          },
        },
        scales: {
          x: { beginAtZero: true, callback: 'unsafe' },
          y: { beginAtZero: false, callback: 'unsafe' },
        },
        animation: {
          onComplete: 'function () { return "unsafe" }',
        },
      },
    },
  });

  assert.equal(spec.title, '图表');
  assert.equal(spec.width, 600);
  assert.equal(spec.height, 400);
  assert.equal(spec.chartjs.type, 'bar');
  assert.deepEqual(spec.chartjs.data.datasets[0].data, [1, 2, 0]);
  assert.deepEqual(spec.chartjs.data.datasets[0].backgroundColor, ['#111', '#222']);
  assert.equal('callback' in spec.chartjs.data.datasets[0], false);
  assert.equal('tooltip' in spec.chartjs.options.plugins, false);
  assert.equal('animation' in spec.chartjs.options, false);
  assert.deepEqual(spec.chartjs.options.scales, {
    x: { beginAtZero: true },
    y: { beginAtZero: false },
  });
});

test('sanitizeChartSpec truncates oversized charts before rendering', () => {
  const labels = Array.from({ length: 80 }, (_, index) => `label-${index}-${'x'.repeat(120)}`);
  const datasets = Array.from({ length: 8 }, (_, index) => ({
    label: `dataset-${index}`,
    data: Array.from({ length: 150 }, (_, valueIndex) => valueIndex),
  }));

  const spec = sanitizeChartSpec({
    title: 'Oversized chart',
    width: 640,
    height: 360,
    chartjs: {
      type: 'line',
      data: { labels, datasets },
    },
  } satisfies ChartSpec);

  assert.equal(spec.chartjs.data.labels.length, 50);
  assert.equal(spec.chartjs.data.labels[0].length, 80);
  assert.equal(spec.chartjs.data.datasets.length, 5);
  assert.equal(spec.chartjs.data.datasets[0].data.length, 50);
  assert.equal(spec.chartjs.data.datasets[0].data.length, spec.chartjs.data.labels.length);
});

test('sanitizeChartSpec preserves safe axis titles and removes unsafe axis callbacks', () => {
  const spec = sanitizeChartSpec({
    title: 'Revenue chart',
    width: 640,
    height: 360,
    chartjs: {
      type: 'line',
      data: {
        labels: ['Jan', 'Feb'],
        datasets: [{ label: 'Revenue', data: [1200, 1500] }],
      },
      options: {
        scales: {
          x: {
            beginAtZero: false,
            title: { display: true, text: 'Month' },
            ticks: {
              autoSkip: false,
              maxRotation: 120,
              minRotation: -20,
              callback: 'function () { return process.env.OPENAI_API_KEY }',
            },
          },
          y: {
            beginAtZero: true,
            title: { text: 'Revenue (USD)' },
            ticks: {
              maxRotation: 45,
              callback: 'function () { return "unsafe" }',
            },
          },
        },
      },
    },
  } satisfies ChartSpec);

  assert.deepEqual(spec.chartjs.options.scales.x, {
    beginAtZero: false,
    title: { display: true, text: 'Month' },
    ticks: { autoSkip: false, maxRotation: 90, minRotation: 0 },
  });
  assert.deepEqual(spec.chartjs.options.scales.y, {
    beginAtZero: true,
    title: { display: true, text: 'Revenue (USD)' },
    ticks: { maxRotation: 45 },
  });
  assert.equal('callback' in spec.chartjs.options.scales.x.ticks, false);
  assert.equal('callback' in spec.chartjs.options.scales.y.ticks, false);
});

test('sanitizeChartSpec converts scatter string coordinate points instead of zeroing them', () => {
  const spec = sanitizeChartSpec({
    title: 'Dose response scatter',
    width: 640,
    height: 360,
    chartjs: {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'score',
          data: [
            { x: '4', y: '80' },
            { x: '6.5', y: '91', r: '3' },
          ],
        }],
      },
    },
  } satisfies ChartSpec);

  assert.equal(spec.chartjs.type, 'scatter');
  assert.deepEqual(spec.chartjs.data.datasets[0].data, [
    { x: 4, y: 80 },
    { x: 6.5, y: 91, r: 3 },
  ]);
});

test('sanitizeChartSpec removes exact latitude and longitude points before external rendering', () => {
  const spec = sanitizeChartSpec({
    title: 'Home location coordinates',
    width: 640,
    height: 360,
    chartjs: {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'GPS coordinates',
          data: [
            { x: '3.141592', y: '101.686855' },
            { x: '3.150000', y: '101.700000' },
          ],
        }],
      },
      options: {
        scales: {
          x: { title: { text: 'Latitude' } },
          y: { title: { text: 'Longitude' } },
        },
      },
    },
  } satisfies ChartSpec);

  const payloadText = JSON.stringify(spec);
  assert.equal(spec.chartjs.type, 'scatter');
  assert.doesNotMatch(payloadText, /3\.141592|101\.686855|3\.150000|101\.700000/);
  assert.deepEqual(spec.chartjs.data.datasets[0].data, [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ]);
});

test('sanitizeChartSpec removes precise coordinate-looking scatter points even without coordinate labels', () => {
  const spec = sanitizeChartSpec({
    title: 'Site scatter',
    width: 640,
    height: 360,
    chartjs: {
      type: 'scatter',
      data: {
        datasets: [{
          label: 'site',
          data: [
            { x: '3.141592', y: '101.686855' },
            { x: '3.150000', y: '101.700000' },
          ],
        }],
      },
      options: {
        scales: {
          x: { title: { text: 'x' } },
          y: { title: { text: 'y' } },
        },
      },
    },
  } satisfies ChartSpec);

  const payloadText = JSON.stringify(spec);
  assert.equal(spec.chartjs.type, 'scatter');
  assert.doesNotMatch(payloadText, /3\.141592|101\.686855|3\.150000|101\.700000/);
  assert.deepEqual(spec.chartjs.data.datasets[0].data, [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ]);
});

test('sanitizeChartSpec redacts private identifiers before external chart rendering', () => {
  const spec = sanitizeChartSpec({
    title: 'Patient name Jane Smith at 3.141592, 101.686855',
    width: 640,
    height: 360,
    chartjs: {
      type: 'bar',
      data: {
        labels: [
          'Patient John Smith john.smith@example.com',
          '客户：张三 +60 12-345 6789',
          'Site 3.141592, 101.686855',
          '学号A24B7 医院号HABC56 门诊号OPQ89',
        ],
        datasets: [{ label: 'MRN: ABC-12345 score', data: [1, 2, 3, 4] }],
      },
      options: {
        plugins: {
          title: { text: 'Participant name Alice Tan phone +1 (555) 123-4567' },
        },
        scales: {
          x: { title: { text: 'subject id: S-1009' } },
          y: { title: { text: 'Score' } },
        },
      },
    },
  } satisfies ChartSpec);

  const payloadText = JSON.stringify(spec);
  assert.match(payloadText, /redacted name/);
  assert.match(payloadText, /redacted email/);
  assert.match(payloadText, /redacted phone/);
  assert.match(payloadText, /redacted identifier/);
  assert.match(payloadText, /redacted coordinates/);
  assert.match(payloadText, /已遮盖姓名/);
  assert.match(payloadText, /已遮盖编号/);
  assert.doesNotMatch(payloadText, /Jane Smith|John Smith|john\.smith@example\.com|345 6789|3\.141592|101\.686855|ABC-12345|Alice Tan|S-1009|学号|A24B7|医院号|HABC56|门诊号|OPQ89/);
});

test('sanitizeChartSpec redacts secrets, tokens, and prompt labels before external chart rendering', () => {
  const spec = sanitizeChartSpec({
    title: 'Bearer abcdefghijklmnopqrstuvwxyz and system prompt',
    width: 640,
    height: 360,
    chartjs: {
      type: 'bar',
      data: {
        labels: ['AWS AKIAABCDEFGHIJKLMNOP', 'SUPABASE_SERVICE_ROLE_KEY', 'developer prompt'],
        datasets: [{ label: 'API key sk-secret123456789', data: [1, 2, 3] }],
      },
      options: {
        scales: {
          x: { title: { display: true, text: 'TOKEN abcdefghijklmnop' } },
          y: { title: { display: true, text: 'Score' } },
        },
      },
    },
  } satisfies ChartSpec);

  const payloadText = JSON.stringify(spec);
  assert.doesNotMatch(payloadText, /Bearer|AKIA|SUPABASE_SERVICE_ROLE_KEY|system prompt|developer prompt|API key|TOKEN/i);
  assert.match(payloadText, /redacted/);
});

test('sanitizeChartSpec redacts private keys and provider tokens before external chart rendering', () => {
  const spec = sanitizeChartSpec({
    title: ['-----BEGIN ' + 'PRIVATE KEY-----', 'abcdefghijklmnopqrstuvwxyz', '-----END ' + 'PRIVATE KEY-----'].join(' '),
    width: 640,
    height: 360,
    chartjs: {
      type: 'bar',
      data: {
        labels: [
          'GitHub ' + ['ghp', 'abcdefghijklmnopqrstuvwxyz1234567890'].join('_'),
          'OpenAI ' + ['sk-proj', 'abcdefghijklmnopqrstuvwxyz123456'].join('-'),
          'Slack ' + ['xoxb', '123456789012', 'abcdefghijklmnop'].join('-'),
        ],
        datasets: [{
          label: 'JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz123456',
          data: [1, 2, 3],
        }],
      },
    },
  } satisfies ChartSpec);

  const payloadText = JSON.stringify(spec);
  assert.doesNotMatch(payloadText, /BEGIN PRIVATE KEY|ghp_|sk-proj-|xoxb-|eyJhbGci/i);
  assert.match(payloadText, /redacted secret/);
});

test('sanitizeChartSpec drops secrets and private identifiers from chart style fields', () => {
  const spec = sanitizeChartSpec({
    title: 'Style privacy check',
    width: 640,
    height: 360,
    chartjs: {
      type: 'bar',
      data: {
        labels: ['A', 'B', 'C'],
        datasets: [{
          label: 'Revenue',
          data: [1, 2, 3],
          backgroundColor: ['#111111', 'alice@example.com', 'Bearer abcdefghijklmnopqrstuvwxyz'],
          borderColor: 'API_KEY=secret123456',
        }],
      },
    },
  } satisfies ChartSpec);

  const dataset = spec.chartjs.data.datasets[0] as any;
  const payloadText = JSON.stringify(spec);

  assert.deepEqual(dataset.backgroundColor, ['#111111']);
  assert.equal('borderColor' in dataset, false);
  assert.doesNotMatch(payloadText, /alice@example\.com|Bearer|API_KEY|secret123456/i);
});

test('sanitizeChartSpec aligns labels and data points for category charts', () => {
  const spec = sanitizeChartSpec({
    title: 'Three month sales',
    width: 640,
    height: 360,
    chartjs: {
      type: 'bar',
      data: {
        labels: ['Jan', 'Feb', 'Mar'],
        datasets: [{ label: 'sales', data: [10, 20, 30, 40, 50], backgroundColor: ['#111', '#222', '#333', '#444'] }],
      },
    },
  } satisfies ChartSpec);

  assert.equal(spec.chartjs.data.labels.length, 3);
  assert.equal(spec.chartjs.data.datasets[0].data.length, 3);
  assert.equal(spec.chartjs.data.datasets[0].backgroundColor.length, 3);
});

test('sanitizeChartSpec makes long-label bar charts horizontal and tall enough to read', () => {
  const spec = sanitizeChartSpec({
    title: 'Clinical cohort comparison',
    width: 620,
    height: 300,
    chartjs: {
      type: 'bar',
      data: {
        labels: [
          'Patients receiving standard care with weekly monitoring',
          'Patients receiving adjusted care after specialist review',
          'Patients with incomplete follow-up documentation',
        ],
        datasets: [{ label: 'Average score', data: [72, 81, 65] }],
      },
      options: {
        indexAxis: 'x',
      },
    },
  } satisfies ChartSpec);

  assert.equal(spec.chartjs.options.indexAxis, 'y');
  assert.equal(spec.height >= 440, true);
  assert.equal(spec.chartjs.data.labels.every((label: string) => label.length <= 80), true);
});

test('sanitizeChartSpec redacts private identifiers in diagram labels and edge labels', () => {
  const spec = sanitizeChartSpec({
    title: 'Patient name Maria Lopez pathway',
    width: 720,
    height: 440,
    diagram: {
      type: 'flowchart',
      direction: 'TB',
      nodes: [
        { id: 'start', label: 'Patient Maria Lopez intake' },
        { id: 'next', label: 'Contact maria.lopez@example.com' },
      ],
      edges: [{ from: 'start', to: 'next', label: 'Phone +1 212 555 0199' }],
    },
  } satisfies ChartSpec);

  const payloadText = JSON.stringify(spec);
  assert.match(payloadText, /redacted name/);
  assert.match(payloadText, /redacted email/);
  assert.match(payloadText, /redacted phone/);
  assert.doesNotMatch(payloadText, /Maria Lopez|maria\.lopez@example\.com|555 0199/);
});

test('sanitizeChartSpec prevents misleading pie charts for negative values', () => {
  const spec = sanitizeChartSpec({
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
  } satisfies ChartSpec);

  assert.equal(spec.chartjs.type, 'bar');
});

test('sanitizeChartSpec converts pie charts over time labels into line charts', () => {
  const spec = sanitizeChartSpec({
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
  } satisfies ChartSpec);

  assert.equal(spec.chartjs.type, 'line');
});

test('sanitizeChartSpec sanitizes diagram nodes and drops invalid arrows', () => {
  const spec = sanitizeChartSpec({
    title: 'Figure 1: Research process',
    width: 720,
    height: 440,
    diagram: {
      type: 'flowchart',
      direction: 'LR',
      nodes: [
        { id: 'collect', label: 'Data collection', shape: 'box' },
        { id: 'analysis', label: 'Analysis '.repeat(20), shape: 'diamond' },
        { id: 'findings', label: 'Findings', shape: 'ellipse' },
      ],
      edges: [
        { from: 'collect', to: 'analysis', label: 'clean data' },
        { from: 'missing', to: 'findings', label: 'invalid' },
        { from: 'findings', to: 'findings', label: 'self loop' },
      ],
    },
  } satisfies ChartSpec);

  assert.equal(spec.diagram?.direction, 'LR');
  assert.equal(spec.diagram?.nodes.length, 3);
  assert.equal(spec.diagram?.nodes[1]?.id, 'n2');
  assert.equal(spec.diagram?.nodes[1]?.label.length, 80);
  assert.deepEqual(spec.diagram?.edges, [{ from: 'n1', to: 'n2', label: 'clean data' }]);
  assert.equal(spec.chartjs, undefined);
});

test('renderChart sends valid diagram specs to the GraphViz renderer', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestedPayload: any = null;
  const png = Buffer.alloc(256, 1);

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requestedUrl = String(url);
    requestedPayload = JSON.parse(String(init?.body));
    return new Response(png, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
  }) as typeof fetch;

  try {
    const result = await renderChart({
      title: 'Figure 1: Research process',
      width: 720,
      height: 440,
      diagram: {
        type: 'flowchart',
        direction: 'TB',
        nodes: [
          { id: 'collect', label: 'Data collection' },
          { id: 'analysis', label: 'Analysis' },
        ],
        edges: [{ from: 'collect', to: 'analysis' }],
      },
    });

    assert.equal(result.png?.length, 256);
    assert.match(requestedUrl, /\/graphviz$/);
    assert.equal(requestedPayload.format, 'png');
    assert.match(requestedPayload.graph, /Data collection/);
    assert.match(requestedPayload.graph, /n1 -> n2/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('renderChart does not call GraphViz when a diagram has no valid arrows', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    throw new Error('should not be called');
  }) as typeof fetch;

  try {
    const result = await renderChart({
      title: 'Figure 1: Broken flowchart',
      width: 720,
      height: 440,
      diagram: {
        type: 'flowchart',
        direction: 'TB',
        nodes: [{ id: 'only', label: 'Only node' }],
        edges: [{ from: 'only', to: 'missing' }],
      },
    });

    assert.equal(result.png, null);
    assert.match(result.error || '', /too few nodes or edges/);
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
