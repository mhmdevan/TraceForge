import { describe, expect, it } from "vitest";
import { ServiceConfig } from "@traceforge/config";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

const config: ServiceConfig = {
  serviceName: "api-gateway",
  host: "0.0.0.0",
  port: 3000,
  environment: "test",
  version: "0.1.0",
  observabilityMode: "none"
};

describe("api-gateway health", () => {
  it("returns an ok health status", () => {
    const service = new HealthService(config);

    expect(service.getHealth()).toMatchObject({
      service: "api-gateway",
      status: "ok",
      version: "0.1.0"
    });
  });

  it("exposes the health response through the controller", () => {
    const controller = new HealthController(new HealthService(config));

    expect(controller.getHealth().service).toBe("api-gateway");
  });
});
