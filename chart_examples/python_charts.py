from math import cos, pi, sin
from pathlib import Path


WIDTH = 720
HEIGHT = 420
PAD = 56
OUTPUT_DIR = Path(__file__).parent / "output" / "python"


def write_svg(name: str, body: str) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <style>
    text {{ font-family: Arial, sans-serif; fill: #1f2937; }}
    .title {{ font-size: 22px; font-weight: 700; }}
    .label {{ font-size: 13px; fill: #4b5563; }}
    .axis {{ stroke: #374151; stroke-width: 2; }}
    .grid {{ stroke: #e5e7eb; stroke-width: 1; }}
  </style>
{body}
</svg>
"""
    (OUTPUT_DIR / name).write_text(svg, encoding="utf-8")


def chart_area():
    return PAD, PAD, WIDTH - PAD, HEIGHT - PAD


def scale_x(value: float, min_x: float, max_x: float) -> float:
    left, _, right, _ = chart_area()
    return left + (value - min_x) / (max_x - min_x) * (right - left)


def scale_y(value: float, min_y: float, max_y: float) -> float:
    _, top, _, bottom = chart_area()
    return bottom - (value - min_y) / (max_y - min_y) * (bottom - top)


def axes(title: str, min_y: float, max_y: float) -> str:
    left, top, right, bottom = chart_area()
    parts = [
        f'  <text x="{WIDTH / 2}" y="32" text-anchor="middle" class="title">{title}</text>',
        f'  <line x1="{left}" y1="{bottom}" x2="{right}" y2="{bottom}" class="axis"/>',
        f'  <line x1="{left}" y1="{top}" x2="{left}" y2="{bottom}" class="axis"/>',
    ]
    for i in range(5):
        value = min_y + (max_y - min_y) * i / 4
        y = scale_y(value, min_y, max_y)
        parts.append(f'  <line x1="{left}" y1="{y:.1f}" x2="{right}" y2="{y:.1f}" class="grid"/>')
        parts.append(f'  <text x="{left - 10}" y="{y + 4:.1f}" text-anchor="end" class="label">{value:.0f}</text>')
    return "\n".join(parts)


def scatter_chart() -> None:
    points = [(1, 2), (2, 3.1), (3, 2.6), (4, 4.2), (5, 4.8), (6, 5.4)]
    parts = [axes("Python Scatter Chart", 0, 6)]
    for x, y in points:
        cx = scale_x(x, 0, 7)
        cy = scale_y(y, 0, 6)
        parts.append(f'  <circle cx="{cx:.1f}" cy="{cy:.1f}" r="7" fill="#2563eb"/>')
    write_svg("scatter.svg", "\n".join(parts))


def line_chart() -> None:
    values = [120, 150, 135, 180, 220, 260, 240]
    max_y = 300
    points = []
    for index, value in enumerate(values):
        points.append((scale_x(index, 0, len(values) - 1), scale_y(value, 0, max_y)))
    path = " ".join(f"{x:.1f},{y:.1f}" for x, y in points)
    parts = [
        axes("Python Line Chart", 0, max_y),
        f'  <polyline points="{path}" fill="none" stroke="#16a34a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
    ]
    for index, (x, y) in enumerate(points):
        parts.append(f'  <circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="#15803d"/>')
        parts.append(f'  <text x="{x:.1f}" y="{HEIGHT - 22}" text-anchor="middle" class="label">D{index + 1}</text>')
    write_svg("line.svg", "\n".join(parts))


def bar_chart() -> None:
    items = [("A", 42), ("B", 68), ("C", 54), ("D", 81), ("E", 63)]
    max_y = 100
    left, _, right, bottom = chart_area()
    slot = (right - left) / len(items)
    bar_width = slot * 0.58
    parts = [axes("Python Bar Chart", 0, max_y)]
    for index, (label, value) in enumerate(items):
        x = left + index * slot + (slot - bar_width) / 2
        y = scale_y(value, 0, max_y)
        height = bottom - y
        parts.append(f'  <rect x="{x:.1f}" y="{y:.1f}" width="{bar_width:.1f}" height="{height:.1f}" rx="5" fill="#f97316"/>')
        parts.append(f'  <text x="{x + bar_width / 2:.1f}" y="{y - 8:.1f}" text-anchor="middle" class="label">{value}</text>')
        parts.append(f'  <text x="{x + bar_width / 2:.1f}" y="{HEIGHT - 22}" text-anchor="middle" class="label">{label}</text>')
    write_svg("bar.svg", "\n".join(parts))


def pie_slice(cx: float, cy: float, radius: float, start: float, end: float, color: str) -> str:
    x1 = cx + radius * cos(start)
    y1 = cy + radius * sin(start)
    x2 = cx + radius * cos(end)
    y2 = cy + radius * sin(end)
    large_arc = 1 if end - start > pi else 0
    return f'  <path d="M {cx:.1f} {cy:.1f} L {x1:.1f} {y1:.1f} A {radius:.1f} {radius:.1f} 0 {large_arc} 1 {x2:.1f} {y2:.1f} Z" fill="{color}"/>'


def pie_chart() -> None:
    items = [("Research", 35, "#2563eb"), ("Writing", 30, "#16a34a"), ("Review", 20, "#f97316"), ("Edit", 15, "#dc2626")]
    total = sum(value for _, value, _ in items)
    cx, cy, radius = 260, 220, 132
    start = -pi / 2
    parts = [f'  <text x="{WIDTH / 2}" y="32" text-anchor="middle" class="title">Python Pie Chart</text>']
    for label, value, color in items:
        angle = value / total * 2 * pi
        end = start + angle
        parts.append(pie_slice(cx, cy, radius, start, end, color))
        mid = (start + end) / 2
        label_x = cx + (radius + 28) * cos(mid)
        label_y = cy + (radius + 28) * sin(mid)
        parts.append(f'  <text x="{label_x:.1f}" y="{label_y:.1f}" text-anchor="middle" class="label">{label} {value}%</text>')
        start = end
    write_svg("pie.svg", "\n".join(parts))


def main() -> None:
    scatter_chart()
    line_chart()
    bar_chart()
    pie_chart()
    print(f"Python charts written to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
