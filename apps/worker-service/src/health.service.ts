import { Inject, Injectable } from "@nestjs/common";
import { ServiceConfig } from "@traceforge/config";
import { HealthResponse } from "@traceforge/contracts";
import { SERVICE_CONFIG } from "./service.constants";

@Injectable()
export class HealthService {
  constructor(
    @Inject(SERVICE_CONFIG)
    private readonly config: ServiceConfig
  ) {}

  getHealth(): HealthResponse {
    return {
      service: this.config.serviceName,
      status: "ok",
      uptimeSeconds: Number(process.uptime().toFixed(3)),
      timestamp: new Date().toISOString(),
      version: this.config.version,
      observabilityMode: this.config.observabilityMode
    };
  }
}
