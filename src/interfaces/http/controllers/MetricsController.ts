import { Controller, Get } from "@nestjs/common";
import { MetricsService } from "../../../infrastructure/observability/MetricsService";

@Controller("metrics")
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  metrics() {
    return {
      service: "distributed-wagering-processor",
      timestamp: new Date().toISOString(),
      metrics: this.metricsService.snapshot(),
    };
  }
}
