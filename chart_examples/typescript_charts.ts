import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const width = 720;
const height = 420;
const pad = 56;
const outputDir = join(dirname(fileURLToPath(import.meta.url)), "output", "typescript");

type Point = { x: number; y: number };
type PieItem = { label: string; value: number; color: string };

function writeSvg(name: string, body: string): void {
  mkdirSync(outputDir, { recursive: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <style>
    text { font-family: Arial, sans-serif; fill: #1f2937; }
    .title { font-size: 22px; font-weight: 700; }
    .label { font-size: 13px; fill: #4b5563; }
    .axis { stroke: #374151; stroke-width: 2; }
    .grid { stroke: #e5e7eb; stroke-width: 1; }
  </style>
${body}
</svg>
`;
  writeFileSync(join(outputDir, name), svg, "utf8");
}

function chartArea(): { left: number; top: number; right: number; bottom: number } {
  return { left: pad, top: pad, right: width - pad, bottom: height - pad };
}

function scaleX(value: number, minX: number, maxX: number): number {
  const { left, right } = chartArea();
  return left + ((value - minX) / (maxX - minX)) * (right - left);
}

function scaleY(value: number, minY: number, maxY: number): number {
  const { top, bottom } = chartArea();
  return bottom - ((value - minY) / (maxY - minY)) * (bottom - top);
}

function axes(title: string, minY: number, maxY: number): string {
  const { left, top, right, bottom } = chartArea();
  const parts = [
    `  <text x="${width / 2}" y="32" text-anchor="middle" class="title">${title}</text>`,
    `  <line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" class="axis"/>`,
    `  <line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" class="axis"/>`,
  ];

  for (let i = 0; i < 5; i += 1) {
    const value = minY + ((maxY - minY) * i) / 4;
    const y = scaleY(value, minY, maxY);
    parts.push(`  <line x1="${left}" y1="${y.toFixed(1)}" x2="${right}" y2="${y.toFixed(1)}" class="grid"/>`);
    parts.push(`  <text x="${left - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="label">${value.toFixed(0)}</text>`);
  }

  return parts.join("\n");
}

function scatterChart(): void {
  const points: Point[] = [
    { x: 1, y: 2 },
    { x: 2, y: 3.1 },
    { x: 3, y: 2.6 },
    { x: 4, y: 4.2 },
    { x: 5, y: 4.8 },
    { x: 6, y: 5.4 },
  ];
  const parts = [axes("TypeScript Scatter Chart", 0, 6)];

  for (const point of points) {
    const cx = scaleX(point.x, 0, 7);
    const cy = scaleY(point.y, 0, 6);
    parts.push(`  <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="7" fill="#2563eb"/>`);
  }

  writeSvg("scatter.svg", parts.join("\n"));
}

function lineChart(): void {
  const values = [120, 150, 135, 180, 220, 260, 240];
  const maxY = 300;
  const points = values.map((value, index) => ({
    x: scaleX(index, 0, values.length - 1),
    y: scaleY(value, 0, maxY),
  }));
  const path = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const parts = [
    axes("TypeScript Line Chart", 0, maxY),
    `  <polyline points="${path}" fill="none" stroke="#16a34a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  ];

  points.forEach((point, index) => {
    parts.push(`  <circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="5" fill="#15803d"/>`);
    parts.push(`  <text x="${point.x.toFixed(1)}" y="${height - 22}" text-anchor="middle" class="label">D${index + 1}</text>`);
  });

  writeSvg("line.svg", parts.join("\n"));
}

function barChart(): void {
  const items = [
    { label: "A", value: 42 },
    { label: "B", value: 68 },
    { label: "C", value: 54 },
    { label: "D", value: 81 },
    { label: "E", value: 63 },
  ];
  const maxY = 100;
  const { left, right, bottom } = chartArea();
  const slot = (right - left) / items.length;
  const barWidth = slot * 0.58;
  const parts = [axes("TypeScript Bar Chart", 0, maxY)];

  items.forEach((item, index) => {
    const x = left + index * slot + (slot - barWidth) / 2;
    const y = scaleY(item.value, 0, maxY);
    const barHeight = bottom - y;
    parts.push(`  <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="5" fill="#f97316"/>`);
    parts.push(`  <text x="${(x + barWidth / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" class="label">${item.value}</text>`);
    parts.push(`  <text x="${(x + barWidth / 2).toFixed(1)}" y="${height - 22}" text-anchor="middle" class="label">${item.label}</text>`);
  });

  writeSvg("bar.svg", parts.join("\n"));
}

function pieSlice(cx: number, cy: number, radius: number, start: number, end: number, color: string): string {
  const x1 = cx + radius * Math.cos(start);
  const y1 = cy + radius * Math.sin(start);
  const x2 = cx + radius * Math.cos(end);
  const y2 = cy + radius * Math.sin(end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `  <path d="M ${cx.toFixed(1)} ${cy.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${radius.toFixed(1)} ${radius.toFixed(1)} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${color}"/>`;
}

function pieChart(): void {
  const items: PieItem[] = [
    { label: "Research", value: 35, color: "#2563eb" },
    { label: "Writing", value: 30, color: "#16a34a" },
    { label: "Review", value: 20, color: "#f97316" },
    { label: "Edit", value: 15, color: "#dc2626" },
  ];
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const cx = 260;
  const cy = 220;
  const radius = 132;
  let start = -Math.PI / 2;
  const parts = [`  <text x="${width / 2}" y="32" text-anchor="middle" class="title">TypeScript Pie Chart</text>`];

  for (const item of items) {
    const angle = (item.value / total) * 2 * Math.PI;
    const end = start + angle;
    parts.push(pieSlice(cx, cy, radius, start, end, item.color));
    const mid = (start + end) / 2;
    const labelX = cx + (radius + 28) * Math.cos(mid);
    const labelY = cy + (radius + 28) * Math.sin(mid);
    parts.push(`  <text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" class="label">${item.label} ${item.value}%</text>`);
    start = end;
  }

  writeSvg("pie.svg", parts.join("\n"));
}

function main(): void {
  scatterChart();
  lineChart();
  barChart();
  pieChart();
  console.log(`TypeScript charts written to ${outputDir}`);
}

main();
