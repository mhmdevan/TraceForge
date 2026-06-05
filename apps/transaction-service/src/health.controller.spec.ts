import { describe, expect, it } from "vitest";
import { ServiceConfig } from "@traceforge/config";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

const config: ServiceConfig = {
  serviceName: "transaction-service",
  host: "0.0.0.0",
  port: 3001,
  environment: "test",
  version: "0.1.0",
  observabilityMode: "none"
};

describe("transaction-service health", () => {
  it("returns an ok health status", () => {
    const service = new HealthService(config);

    expect(service.getHealth()).toMatchObject({
      service: "transaction-service",
      status: "ok",
      version: "0.1.0"
    });
  });

  it("exposes the health response through the controller", () => {
    const controller = new HealthController(new HealthService(config));

    expect(controller.getHealth().service).toBe("transaction-service");
  });
});
