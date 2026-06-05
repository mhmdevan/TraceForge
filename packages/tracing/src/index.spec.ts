import { describe, expect, it } from "vitest";
import { createInMemoryTracer, createNoopTracer, SpanRecord } from "./index";

describe("tracing", () => {
  it("executes work with the noop tracer", async () => {
    const tracer = createNoopTracer();

    await expect(tracer.withSpan("health.check", () => "ok")).resolves.toBe("ok");
  });

  it("records spans with attributes in memory", async () => {
    const spans: SpanRecord[] = [];
    const tracer = createInMemoryTracer(spans);

    await tracer.withSpan("payment.call", () => Promise.resolve(), {
      provider: "simulated"
    });

    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      name: "payment.call",
      attributes: { provider: "simulated" }
    });
  });
});
