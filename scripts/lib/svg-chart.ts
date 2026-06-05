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

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
