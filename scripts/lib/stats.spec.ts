import { describe, expect, it } from "vitest";
import {
  bootstrapCI,
  chiSquareSf,
  ciOverlap,
  cliffsDelta,
  kruskalWallis,
  mannWhitneyU,
  median,
  mulberry32,
  normalCdf,
  quantile,
  summarize
} from "./stats";

describe("descriptive statistics", () => {
  it("computes type-7 quantiles and median", () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 6);
    expect(quantile([1, 2, 3, 4], 0.75)).toBeCloseTo(3.25, 6);
  });

  it("summarizes with IQR and a bootstrap CI", () => {
    const s = summarize([10, 12, 11, 13, 9], mulberry32(1));
    expect(s.n).toBe(5);
    expect(s.median).toBe(11);
    expect(s.iqr).toBeCloseTo(2, 6);
    expect(s.ci95[0]).toBeLessThanOrEqual(s.median);
    expect(s.ci95[1]).toBeGreaterThanOrEqual(s.median);
  });

  it("returns a degenerate CI for constant data", () => {
    expect(bootstrapCI([5, 5, 5], mulberry32(2))).toEqual([5, 5]);
  });
});

describe("normal and chi-square", () => {
  it("matches known standard-normal CDF values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it("matches known chi-square critical p-values", () => {
    // df=1 critical value 3.841 and df=2 value 5.991 both correspond to p=0.05.
    expect(chiSquareSf(3.841, 1)).toBeCloseTo(0.05, 3);
    expect(chiSquareSf(5.991, 2)).toBeCloseTo(0.05, 3);
    // For df=2 the survival function is exactly exp(-x/2).
    expect(chiSquareSf(7.2, 2)).toBeCloseTo(Math.exp(-3.6), 4);
  });
});

describe("non-parametric tests", () => {
  it("Mann-Whitney U is 0 for fully separated groups and significant", () => {
    const result = mannWhitneyU([1, 2, 3, 4], [5, 6, 7, 8]);
    expect(result.u).toBe(0);
    expect(result.p).toBeLessThan(0.05);
  });

  it("Mann-Whitney U is non-significant for identical groups", () => {
    const result = mannWhitneyU([1, 2, 3, 4], [1, 2, 3, 4]);
    expect(result.p).toBeGreaterThan(0.9);
  });

  it("Cliff's delta captures direction and magnitude", () => {
    expect(cliffsDelta([1, 2, 3], [4, 5, 6])).toEqual({ delta: -1, magnitude: "large" });
    expect(cliffsDelta([4, 5, 6], [1, 2, 3])).toEqual({ delta: 1, magnitude: "large" });
    expect(cliffsDelta([1, 2, 3], [1, 2, 3]).magnitude).toBe("negligible");
  });

  it("Kruskal-Wallis matches a textbook example", () => {
    const result = kruskalWallis([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9]
    ]);
    expect(result.h).toBeCloseTo(7.2, 4);
    expect(result.df).toBe(2);
    expect(result.p).toBeCloseTo(Math.exp(-3.6), 3);
  });
});

describe("confidence-interval overlap", () => {
  it("detects overlap and separation", () => {
    expect(ciOverlap([1, 2], [3, 4])).toBe(false);
    expect(ciOverlap([1, 3], [2, 4])).toBe(true);
    expect(ciOverlap([1, 5], [2, 3])).toBe(true);
  });
});
