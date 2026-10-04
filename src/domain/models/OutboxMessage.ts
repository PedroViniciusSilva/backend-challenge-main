import { IntegrationEvent } from "../events/IntegrationEvent";

export type OutboxPayload = Record<string, unknown>;

export interface OutboxMessageState {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: OutboxPayload;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
}

export class OutboxMessage {
  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    public readonly payload: OutboxPayload,
    public readonly occurredAt: Date,
    private _attempts: number,
    private _nextAttemptAt?: Date,
    private _publishedAt?: Date,
  ) {}

  public static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    const serialized = event.toJSON();
    return new OutboxMessage(
      event.eventId,
      event.aggregateId,
      event.eventType,
      serialized as unknown as OutboxPayload,
      event.occurredAt,
      0, // Inicia com 0 tentativas
      new Date(),
      undefined,
    );
  }

  public static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  public get attempts(): number {
    return this._attempts;
  }

  public get nextAttemptAt(): Date | undefined {
    return this._nextAttemptAt;
  }

  public get publishedAt(): Date | undefined {
    return this._publishedAt;
  }

  public isPending(): boolean {
    return this._publishedAt === undefined;
  }

  public isDue(now: Date = new Date()): boolean {
    if (!this.isPending()) {
      return false;
    }
    if (!this._nextAttemptAt) {
      return true;
    }
    return this._nextAttemptAt.getTime() <= now.getTime();
  }

  public markPublished(at: Date = new Date()): void {
    this._publishedAt = at;
  }

  public scheduleRetry(now: Date = new Date()): void {
    this._attempts += 1;
    const delaySeconds = Math.pow(2, this._attempts);
    this._nextAttemptAt = new Date(now.getTime() + delaySeconds * 1000);
  }
}
