import { MemoryPressureConfig } from "@traceforge/config";

export interface MemoryPressureHandle {
  stop(): void;
  allocatedMb(): number;
}

// Retains heap allocations to shrink available headroom (the F6 memory-pressure
// scenario in docs/failure-injection-protocol.md). It allocates an initial block
// and can grow slowly over time to mimic a leak, so latency and error growth
// become observable under load.
export function startMemoryPressure(config: MemoryPressureConfig): MemoryPressureHandle {
  if (!config.enabled || (config.initialMb === 0 && config.leakMbPerMinute === 0)) {
    return {
      stop() {},
      allocatedMb: () => 0
    };
  }

  const retained: Buffer[] = [];
  const allocateMb = (megabytes: number): void => {
    for (let index = 0; index < megabytes; index += 1) {
      // Fill the buffer so the pages are actually resident, not just reserved.
      retained.push(Buffer.alloc(1024 * 1024, 1));
    }
  };

  allocateMb(config.initialMb);

  let timer: NodeJS.Timeout | undefined;

  if (config.leakMbPerMinute > 0) {
    timer = setInterval(() => {
      allocateMb(config.leakMbPerMinute);
    }, 60_000);
    timer.unref();
  }

  return {
    stop() {
      if (timer) {
        clearInterval(timer);
      }
      retained.length = 0;
    },
    allocatedMb: () => retained.length
  };
}
