// Dependency-free statistics for publication-grade analysis: robust summaries,
// bootstrap confidence intervals, non-parametric significance tests, and effect
// sizes. Latency distributions are heavy-tailed and non-normal, so the defaults
// here are non-parametric (median/IQR, Mann-Whitney, Kruskal-Wallis, Cliff's
// delta) rather than mean/t-test based.
//
// Every function is unit-tested against textbook values in stats.spec.ts.

export type Summary = {
  n: number;
  mean: number;
  median: number;
  std: number;
  q1: number;
  q3: number;
  iqr: number;
  min: number;
  max: number;
  cv: number; // coefficient of variation (std / mean)
  ci95: [number, number]; // bootstrap 95% CI of the median
};

// Deterministic PRNG so bootstrap CIs are reproducible.
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function standardDeviation(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const avg = mean(values);
  const variance =
    values.reduce((total, value) => total + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// Linear-interpolation quantile (type 7, the numpy/R default).
export function quantile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) {
    return sorted[0];
  }
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function median(values: number[]): number {
  return quantile(values, 0.5);
}

// Percentile bootstrap CI of a statistic (median by default).
export function bootstrapCI(
  values: number[],
  rng: () => number,
  options: {
    statistic?: (sample: number[]) => number;
    resamples?: number;
    alpha?: number;
  } = {}
): [number, number] {
  const statistic = options.statistic ?? median;
  const resamples = options.resamples ?? 5000;
  const alpha = options.alpha ?? 0.05;
  if (values.length === 0) {
    return [0, 0];
  }
  if (values.length === 1) {
    return [values[0], values[0]];
  }

  const estimates: number[] = [];
  for (let i = 0; i < resamples; i += 1) {
    const sample: number[] = [];
    for (let j = 0; j < values.length; j += 1) {
      sample.push(values[Math.floor(rng() * values.length)]);
    }
    estimates.push(statistic(sample));
  }
  return [quantile(estimates, alpha / 2), quantile(estimates, 1 - alpha / 2)];
}

export function summarize(values: number[], rng: () => number): Summary {
  const avg = mean(values);
  const std = standardDeviation(values);
  return {
    n: values.length,
    mean: avg,
    median: median(values),
    std,
    q1: quantile(values, 0.25),
    q3: quantile(values, 0.75),
    iqr: quantile(values, 0.75) - quantile(values, 0.25),
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
    cv: avg === 0 ? 0 : std / avg,
    ci95: bootstrapCI(values, rng)
  };
}

export function ciOverlap(a: [number, number], b: [number, number]): boolean {
  return !(a[1] < b[0] || b[1] < a[0]);
}

// --- non-parametric tests -----------------------------------------------------

type Ranked = { values: number[]; tieCorrection: number };

// Average ranks with a tie-correction term sum(t^3 - t).
function rank(all: number[]): Ranked {
  const indexed = all.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(all.length);
  let tieCorrection = 0;
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].value === indexed[i].value) {
      j += 1;
    }
    const averageRank = (i + j) / 2 + 1; // ranks are 1-based
    const tie = j - i + 1;
    if (tie > 1) {
      tieCorrection += tie ** 3 - tie;
    }
    for (let k = i; k <= j; k += 1) {
      ranks[indexed[k].index] = averageRank;
    }
    i = j + 1;
  }
  return { values: ranks, tieCorrection };
}

export type MannWhitney = { u: number; z: number; p: number };

// Two-sided Mann-Whitney U with tie correction and normal approximation
// (continuity-corrected). For very small samples the p-value is approximate.
export function mannWhitneyU(a: number[], b: number[]): MannWhitney {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 === 0 || n2 === 0) {
    return { u: 0, z: 0, p: 1 };
  }
  const ranked = rank([...a, ...b]);
  const r1 = ranked.values.slice(0, n1).reduce((total, value) => total + value, 0);
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const muU = (n1 * n2) / 2;
  const n = n1 + n2;
  const tieTerm = ranked.tieCorrection / (n * (n - 1));
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tieTerm));
  if (sigma === 0) {
    return { u: u1, z: 0, p: 1 };
  }
  const z = (u1 - muU - Math.sign(u1 - muU) * 0.5) / sigma;
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return { u: u1, z, p: Math.min(1, Math.max(0, p)) };
}

export type CliffsDelta = {
  delta: number;
  magnitude: "negligible" | "small" | "medium" | "large";
};

export function cliffsDelta(a: number[], b: number[]): CliffsDelta {
  if (a.length === 0 || b.length === 0) {
    return { delta: 0, magnitude: "negligible" };
  }
  let greater = 0;
  let less = 0;
  for (const x of a) {
    for (const y of b) {
      if (x > y) {
        greater += 1;
      } else if (x < y) {
        less += 1;
      }
    }
  }
  const delta = (greater - less) / (a.length * b.length);
  const abs = Math.abs(delta);
  const magnitude =
    abs < 0.147 ? "negligible" : abs < 0.33 ? "small" : abs < 0.474 ? "medium" : "large";
  return { delta, magnitude };
}

export type KruskalWallis = { h: number; df: number; p: number };

export function kruskalWallis(groups: number[][]): KruskalWallis {
  const valid = groups.filter((group) => group.length > 0);
  const n = valid.reduce((total, group) => total + group.length, 0);
  if (valid.length < 2 || n === 0) {
    return { h: 0, df: Math.max(0, valid.length - 1), p: 1 };
  }
  const ranked = rank(valid.flat());
  let offset = 0;
  let sum = 0;
  for (const group of valid) {
    const groupRanks = ranked.values.slice(offset, offset + group.length);
    const rankSum = groupRanks.reduce((total, value) => total + value, 0);
    sum += rankSum ** 2 / group.length;
    offset += group.length;
  }
  let h = (12 / (n * (n + 1))) * sum - 3 * (n + 1);
  const correction = 1 - ranked.tieCorrection / (n ** 3 - n);
  if (correction > 0) {
    h /= correction;
  }
  const df = valid.length - 1;
  return { h, df, p: chiSquareSf(h, df) };
}

// --- numerical special functions ----------------------------------------------

// Standard normal CDF via the Abramowitz & Stegun erf approximation (7.1.26).
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function erf(x: number): number {
  const sign = Math.sign(x);
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return sign * y;
}

// Survival function of the chi-square distribution: P(X > x) for k degrees of
// freedom = 1 - regularized lower incomplete gamma P(k/2, x/2).
export function chiSquareSf(x: number, k: number): number {
  if (x <= 0 || k <= 0) {
    return 1;
  }
  return 1 - regularizedLowerGamma(k / 2, x / 2);
}

function gammaln(x: number): number {
  // Canonical Lanczos approximation coefficients (Numerical Recipes). Their final
  // ULPs are not exactly representable as doubles — intentional and harmless for a
  // gamma / p-value approximation.
  /* eslint-disable no-loss-of-precision */
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5
  ];
  /* eslint-enable no-loss-of-precision */
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.00000000019;
  for (let j = 0; j < 6; j += 1) {
    y += 1;
    ser += c[j] / y;
  }
  return -tmp + Math.log((Math.sqrt(2 * Math.PI) * ser) / x);
}

// Regularized lower incomplete gamma P(s, x) (Numerical Recipes gser/gcf).
function regularizedLowerGamma(s: number, x: number): number {
  if (x < 0 || s <= 0) {
    return 0;
  }
  if (x === 0) {
    return 0;
  }
  if (x < s + 1) {
    // Series representation.
    let term = 1 / s;
    let sum = term;
    for (let n = 1; n < 200; n += 1) {
      term *= x / (s + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) {
        break;
      }
    }
    return sum * Math.exp(-x + s * Math.log(x) - gammaln(s));
  }
  // Continued fraction (Lentz's method) for the upper gamma Q, then P = 1 - Q.
  const tiny = 1e-30;
  let b = x + 1 - s;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 200; i += 1) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) {
      d = tiny;
    }
    c = b + an / c;
    if (Math.abs(c) < tiny) {
      c = tiny;
    }
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) {
      break;
    }
  }
  const q = Math.exp(-x + s * Math.log(x) - gammaln(s)) * h;
  return 1 - q;
}
