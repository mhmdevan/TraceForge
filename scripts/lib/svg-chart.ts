// Dependency-free SVG bar-chart renderer shared by the results scripts.
// Supports grouped series and negative values (with a zero baseline) so it can
// draw both raw comparisons and overhead/delta charts.

export type ChartSeries = {
  name: string;
  color: string;
  values: number[];
  colors?: string[];
};

export function renderBarChart(options: {
  title: string;
  subtitle?: string;
  categories: string[];
  series: ChartSeries[];
  yAxisLabel: string;
  format: (value: number) => string;
}): string {
  const width = 960;
  const height = 470;
  const margin = { top: 78, right: 40, bottom: 84, left: 84 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const values = options.series.flatMap((series) => series.values);
  const rawMax = Math.max(0, ...values);
  const rawMin = Math.min(0, ...values);
  const maxValue = rawMax === 0 && rawMin === 0 ? 1 : rawMax;
  const minValue = rawMin;
  const span = maxValue - minValue || 1;

  const yOf = (value: number): number =>
    margin.top + plotHeight - ((value - minValue) / span) * plotHeight;
  const zeroY = yOf(0);

  const groupCount = options.categories.length || 1;
  const groupWidth = plotWidth / groupCount;
  const seriesCount = options.series.length;
  const innerGap = 6;
  const barWidth = Math.max(4, (groupWidth - innerGap * (seriesCount + 1)) / seriesCount);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system, Segoe UI, Roboto, sans-serif">`
  );
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  parts.push(
    `<text x="${margin.left}" y="34" font-size="20" font-weight="600" fill="#1f2933">${escapeXml(options.title)}</text>`
  );
  if (options.subtitle) {
    parts.push(
      `<text x="${margin.left}" y="56" font-size="13" fill="#62707f">${escapeXml(options.subtitle)}</text>`
    );
  }

  // Y gridlines and tick labels.
  const tickCount = 4;
  for (let tick = 0; tick <= tickCount; tick += 1) {
    const value = minValue + (span * tick) / tickCount;
    const y = yOf(value);
    parts.push(
      `<line x1="${margin.left}" y1="${y.toFixed(1)}" x2="${(width - margin.right).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e4e9f0" stroke-width="1"/>`
    );
    parts.push(
      `<text x="${margin.left - 10}" y="${(y + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="#8a97a6">${options.format(value)}</text>`
    );
  }

  // Zero line emphasis when the chart spans negative values.
  if (minValue < 0) {
    parts.push(
      `<line x1="${margin.left}" y1="${zeroY.toFixed(1)}" x2="${(width - margin.right).toFixed(1)}" y2="${zeroY.toFixed(1)}" stroke="#9aa7b5" stroke-width="1.5"/>`
    );
  }

  parts.push(
    `<text transform="translate(22 ${margin.top + plotHeight / 2}) rotate(-90)" font-size="12" text-anchor="middle" fill="#62707f">${escapeXml(options.yAxisLabel)}</text>`
  );

  // Bars and category labels.
  options.categories.forEach((category, groupIndex) => {
    const groupX = margin.left + groupIndex * groupWidth;

    options.series.forEach((series, seriesIndex) => {
      const value = series.values[groupIndex] ?? 0;
      const x = groupX + innerGap * (seriesIndex + 1) + seriesIndex * barWidth;
      const barTop = Math.min(yOf(value), zeroY);
      const barHeight = Math.max(1, Math.abs(yOf(value) - zeroY));
      const fill = series.colors?.[groupIndex] ?? series.color;

      parts.push(
        `<rect x="${x.toFixed(1)}" y="${barTop.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="3" fill="${fill}"/>`
      );

      const labelY = value >= 0 ? barTop - 5 : barTop + barHeight + 13;
      parts.push(
        `<text x="${(x + barWidth / 2).toFixed(1)}" y="${labelY.toFixed(1)}" font-size="10" text-anchor="middle" fill="#52606d">${options.format(value)}</text>`
      );
    });

    parts.push(
      `<text x="${(groupX + groupWidth / 2).toFixed(1)}" y="${(margin.top + plotHeight + 22).toFixed(1)}" font-size="12" text-anchor="middle" fill="#3e4c59">${escapeXml(category)}</text>`
    );
  });

  // Legend (only when more than one series).
  if (seriesCount > 1) {
    const legendY = height - 26;
    let legendX = margin.left;
    for (const series of options.series) {
      parts.push(
        `<rect x="${legendX}" y="${legendY - 10}" width="12" height="12" rx="2" fill="${series.color}"/>`
      );
      parts.push(
        `<text x="${legendX + 18}" y="${legendY}" font-size="12" fill="#3e4c59">${escapeXml(series.name)}</text>`
      );
      legendX += 28 + series.name.length * 8;
    }
  }

  parts.push("</svg>");
  return `${parts.join("\n")}\n`;
}

export type LinePoint = { x: number; y: number };
export type LineSeries = { name: string; color: string; points: LinePoint[] };

// Multi-series line chart with a numeric x-axis — used for latency-versus-throughput
// curves where each mode is a series and x is the achieved request rate.
export function renderLineChart(options: {
  title: string;
  subtitle?: string;
  series: LineSeries[];
  xAxisLabel: string;
  yAxisLabel: string;
  formatX: (value: number) => string;
  formatY: (value: number) => string;
}): string {
  const width = 960;
  const height = 480;
  const margin = { top: 78, right: 150, bottom: 70, left: 84 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const allPoints = options.series.flatMap((series) => series.points);
  const xs = allPoints.map((point) => point.x);
  const ys = allPoints.map((point) => point.y);
  const xMin = xs.length ? Math.min(...xs) : 0;
  const xMax = xs.length ? Math.max(...xs) : 1;
  const yMax = ys.length ? Math.max(...ys) : 1;
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax || 1;

  const xOf = (value: number): number =>
    margin.left + ((value - xMin) / xSpan) * plotWidth;
  const yOf = (value: number): number =>
    margin.top + plotHeight - (value / ySpan) * plotHeight;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system, Segoe UI, Roboto, sans-serif">`
  );
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  parts.push(
    `<text x="${margin.left}" y="34" font-size="20" font-weight="600" fill="#1f2933">${escapeXml(options.title)}</text>`
  );
  if (options.subtitle) {
    parts.push(
      `<text x="${margin.left}" y="56" font-size="13" fill="#62707f">${escapeXml(options.subtitle)}</text>`
    );
  }

  const tickCount = 4;
  // Y gridlines.
  for (let tick = 0; tick <= tickCount; tick += 1) {
    const value = (ySpan * tick) / tickCount;
    const y = yOf(value);
    parts.push(
      `<line x1="${margin.left}" y1="${y.toFixed(1)}" x2="${(margin.left + plotWidth).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e4e9f0" stroke-width="1"/>`
    );
    parts.push(
      `<text x="${margin.left - 10}" y="${(y + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="#8a97a6">${options.formatY(value)}</text>`
    );
  }
  // X tick labels.
  for (let tick = 0; tick <= tickCount; tick += 1) {
    const value = xMin + (xSpan * tick) / tickCount;
    const x = xOf(value);
    parts.push(
      `<text x="${x.toFixed(1)}" y="${(margin.top + plotHeight + 20).toFixed(1)}" font-size="11" text-anchor="middle" fill="#8a97a6">${options.formatX(value)}</text>`
    );
  }
  parts.push(
    `<text x="${(margin.left + plotWidth / 2).toFixed(1)}" y="${(height - 18).toFixed(1)}" font-size="12" text-anchor="middle" fill="#62707f">${escapeXml(options.xAxisLabel)}</text>`
  );
  parts.push(
    `<text transform="translate(22 ${margin.top + plotHeight / 2}) rotate(-90)" font-size="12" text-anchor="middle" fill="#62707f">${escapeXml(options.yAxisLabel)}</text>`
  );

  // Series polylines + markers.
  options.series.forEach((series) => {
    const sorted = [...series.points].sort((a, b) => a.x - b.x);
    if (sorted.length === 0) {
      return;
    }
    const polyline = sorted
      .map((point) => `${xOf(point.x).toFixed(1)},${yOf(point.y).toFixed(1)}`)
      .join(" ");
    parts.push(
      `<polyline points="${polyline}" fill="none" stroke="${series.color}" stroke-width="2.5"/>`
    );
    for (const point of sorted) {
      parts.push(
        `<circle cx="${xOf(point.x).toFixed(1)}" cy="${yOf(point.y).toFixed(1)}" r="3.5" fill="${series.color}"/>`
      );
    }
  });

  // Legend (right side).
  let legendY = margin.top + 4;
  for (const series of options.series) {
    parts.push(
      `<line x1="${(margin.left + plotWidth + 16).toFixed(1)}" y1="${legendY - 4}" x2="${(margin.left + plotWidth + 34).toFixed(1)}" y2="${legendY - 4}" stroke="${series.color}" stroke-width="2.5"/>`
    );
    parts.push(
      `<text x="${(margin.left + plotWidth + 40).toFixed(1)}" y="${legendY}" font-size="12" fill="#3e4c59">${escapeXml(series.name)}</text>`
    );
    legendY += 22;
  }

  parts.push("</svg>");
  return `${parts.join("\n")}\n`;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type BoxStats = {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  ciLo: number; // 95% CI of the median (lower)
  ciHi: number; // 95% CI of the median (upper)
};

// Box-and-whisker plot with an overlaid 95% CI-of-median error bar. The box is
// the IQR (Q1-Q3), the whiskers span min-max, and the magenta error bar is the
// bootstrap CI of the median — the publication-standard figure for comparing
// distributions across groups.
export function renderBoxPlot(options: {
  title: string;
  subtitle?: string;
  categories: string[];
  boxes: BoxStats[];
  yAxisLabel: string;
  format: (value: number) => string;
}): string {
  const width = 960;
  const height = 470;
  const margin = { top: 78, right: 40, bottom: 84, left: 84 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const values = options.boxes.flatMap((box) => [box.min, box.max, box.ciLo, box.ciHi]);
  const rawMin = values.length ? Math.min(...values) : 0;
  const rawMax = values.length ? Math.max(...values) : 1;
  const pad = (rawMax - rawMin) * 0.08 || 1;
  const minValue = rawMin - pad;
  const maxValue = rawMax + pad;
  const span = maxValue - minValue || 1;

  const yOf = (value: number): number =>
    margin.top + plotHeight - ((value - minValue) / span) * plotHeight;

  const groupCount = options.categories.length || 1;
  const groupWidth = plotWidth / groupCount;
  const boxWidth = Math.min(120, groupWidth * 0.4);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system, Segoe UI, Roboto, sans-serif">`
  );
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  parts.push(
    `<text x="${margin.left}" y="34" font-size="20" font-weight="600" fill="#1f2933">${escapeXml(options.title)}</text>`
  );
  if (options.subtitle) {
    parts.push(
      `<text x="${margin.left}" y="56" font-size="13" fill="#62707f">${escapeXml(options.subtitle)}</text>`
    );
  }

  const tickCount = 4;
  for (let tick = 0; tick <= tickCount; tick += 1) {
    const value = minValue + (span * tick) / tickCount;
    const y = yOf(value);
    parts.push(
      `<line x1="${margin.left}" y1="${y.toFixed(1)}" x2="${(width - margin.right).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e4e9f0" stroke-width="1"/>`
    );
    parts.push(
      `<text x="${margin.left - 10}" y="${(y + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="#8a97a6">${options.format(value)}</text>`
    );
  }
  parts.push(
    `<text transform="translate(22 ${margin.top + plotHeight / 2}) rotate(-90)" font-size="12" text-anchor="middle" fill="#62707f">${escapeXml(options.yAxisLabel)}</text>`
  );

  options.categories.forEach((category, index) => {
    const box = options.boxes[index];
    if (!box) {
      return;
    }
    const cx = margin.left + (index + 0.5) * groupWidth;
    const left = cx - boxWidth / 2;
    const yMin = yOf(box.min);
    const yMax = yOf(box.max);
    const yQ1 = yOf(box.q1);
    const yQ3 = yOf(box.q3);
    const yMed = yOf(box.median);

    // Whisker line + caps.
    parts.push(
      `<line x1="${cx.toFixed(1)}" y1="${yMax.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${yMin.toFixed(1)}" stroke="#9aa7b5" stroke-width="1"/>`
    );
    parts.push(
      `<line x1="${(cx - boxWidth / 4).toFixed(1)}" y1="${yMax.toFixed(1)}" x2="${(cx + boxWidth / 4).toFixed(1)}" y2="${yMax.toFixed(1)}" stroke="#9aa7b5" stroke-width="1"/>`
    );
    parts.push(
      `<line x1="${(cx - boxWidth / 4).toFixed(1)}" y1="${yMin.toFixed(1)}" x2="${(cx + boxWidth / 4).toFixed(1)}" y2="${yMin.toFixed(1)}" stroke="#9aa7b5" stroke-width="1"/>`
    );

    // IQR box.
    const boxTop = Math.min(yQ1, yQ3);
    const boxHeight = Math.max(1, Math.abs(yQ1 - yQ3));
    parts.push(
      `<rect x="${left.toFixed(1)}" y="${boxTop.toFixed(1)}" width="${boxWidth.toFixed(1)}" height="${boxHeight.toFixed(1)}" fill="#cfe0f1" stroke="#4e79a7" stroke-width="1.5"/>`
    );
    // Median line.
    parts.push(
      `<line x1="${left.toFixed(1)}" y1="${yMed.toFixed(1)}" x2="${(left + boxWidth).toFixed(1)}" y2="${yMed.toFixed(1)}" stroke="#1f4e79" stroke-width="2.5"/>`
    );

    // 95% CI-of-median error bar (offset slightly right of centre).
    const ciX = cx + boxWidth / 2 + 10;
    const yCiLo = yOf(box.ciLo);
    const yCiHi = yOf(box.ciHi);
    parts.push(
      `<line x1="${ciX.toFixed(1)}" y1="${yCiHi.toFixed(1)}" x2="${ciX.toFixed(1)}" y2="${yCiLo.toFixed(1)}" stroke="#e15759" stroke-width="2"/>`
    );
    parts.push(
      `<line x1="${(ciX - 4).toFixed(1)}" y1="${yCiHi.toFixed(1)}" x2="${(ciX + 4).toFixed(1)}" y2="${yCiHi.toFixed(1)}" stroke="#e15759" stroke-width="2"/>`
    );
    parts.push(
      `<line x1="${(ciX - 4).toFixed(1)}" y1="${yCiLo.toFixed(1)}" x2="${(ciX + 4).toFixed(1)}" y2="${yCiLo.toFixed(1)}" stroke="#e15759" stroke-width="2"/>`
    );

    parts.push(
      `<text x="${cx.toFixed(1)}" y="${(yMed - 8).toFixed(1)}" font-size="10" text-anchor="middle" fill="#52606d">${options.format(box.median)}</text>`
    );
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${(margin.top + plotHeight + 22).toFixed(1)}" font-size="12" text-anchor="middle" fill="#3e4c59">${escapeXml(category)}</text>`
    );
  });

  // Legend.
  const legendY = height - 26;
  parts.push(
    `<rect x="${margin.left}" y="${legendY - 10}" width="12" height="12" rx="2" fill="#cfe0f1" stroke="#4e79a7"/>`
  );
  parts.push(
    `<text x="${margin.left + 18}" y="${legendY}" font-size="12" fill="#3e4c59">IQR (Q1-Q3), median</text>`
  );
  parts.push(
    `<line x1="${margin.left + 168}" y1="${legendY - 10}" x2="${margin.left + 168}" y2="${legendY + 2}" stroke="#e15759" stroke-width="2"/>`
  );
  parts.push(
    `<text x="${margin.left + 178}" y="${legendY}" font-size="12" fill="#3e4c59">95% CI of median</text>`
  );

  parts.push("</svg>");
  return `${parts.join("\n")}\n`;
}
