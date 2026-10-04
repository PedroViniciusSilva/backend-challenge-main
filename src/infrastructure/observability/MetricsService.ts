import { Injectable } from "@nestjs/common";

type MetricName =
  | "transactions_processed"
  | "transactions_rejected"
  | "duplicates_detected"
  | "message_retries"
  | "messages_dlq"
  | "lock_conflicts";

@Injectable()
export class MetricsService {
  private readonly counters = new Map<MetricName, number>();
  private outboxLag = 0;
  private processingLatencyMs = 0;

  increment(name: MetricName, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  observeProcessing(latencyMs: number): void {
    this.processingLatencyMs = latencyMs;
  }

  observeOutboxLag(count: number): void {
    this.outboxLag = count;
  }

  snapshot(): Record<string, number> {
    return {
      ...Object.fromEntries(this.counters),
      outbox_lag: this.outboxLag,
      processing_latency_ms: this.processingLatencyMs,
    };
  }
}
