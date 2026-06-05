import { describe, expect, it } from "vitest";
import { startMemoryPressure } from "./memory-pressure";

describe("memory pressure", () => {
  it("allocates nothing when disabled", () => {
    const handle = startMemoryPressure({
      enabled: false,
      initialMb: 64,
      leakMbPerMinute: 0
    });

    expect(handle.allocatedMb()).toBe(0);
    handle.stop();
  });

  it("retains the configured initial allocation when enabled", () => {
    const handle = startMemoryPressure({
      enabled: true,
      initialMb: 2,
      leakMbPerMinute: 0
    });

    expect(handle.allocatedMb()).toBe(2);
    handle.stop();
    expect(handle.allocatedMb()).toBe(0);
  });
});
