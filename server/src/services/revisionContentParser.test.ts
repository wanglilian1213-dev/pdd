import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRevisionOutput } from './revisionContentParser';

test('parseRevisionOutput accepts structured diagram blocks as renderable visuals', () => {
  const parsed = parseRevisionOutput(`
Introduction.

[CHART_BEGIN]
{
  "title": "Figure 1: Research process",
  "width": 720,
  "height": 440,
  "diagram": {
    "type": "flowchart",
    "direction": "TB",
    "nodes": [
      { "id": "collect", "label": "Data collection" },
      { "id": "analysis", "label": "Analysis" }
    ],
    "edges": [
      { "from": "collect", "to": "analysis" }
    ]
  }
}
[CHART_END]
`);

  assert.equal(parsed.charts.length, 1);
  assert.equal(parsed.charts[0]?.spec.diagram?.nodes.length, 2);
  assert.match(parsed.text, /\[\[CHART_PLACEHOLDER_1\]\]/);
});

test('parseRevisionOutput rejects empty diagram blocks instead of treating them as delivered visuals', () => {
  const parsed = parseRevisionOutput(`
[CHART_BEGIN]
{
  "title": "Figure 1: Empty flowchart",
  "diagram": {
    "type": "flowchart",
    "direction": "TB",
    "nodes": [],
    "edges": []
  }
}
[CHART_END]
`);

  assert.equal(parsed.charts.length, 0);
  assert.match(parsed.text, /图 1：图表数据解析失败/);
});
