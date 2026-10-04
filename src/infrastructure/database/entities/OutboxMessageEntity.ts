import { Entity, PrimaryKey, Property, Index } from "@mikro-orm/core";

@Entity({ tableName: "outbox_messages" })
@Index({ properties: ["publishedAt", "nextAttemptAt"] }) // Otimiza a busca dos workers
export class OutboxMessageEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "varchar", length: 64 })
  aggregateId!: string;

  @Property({ type: "varchar", length: 64 })
  eventType!: string;

  @Property({ type: "jsonb" })
  payload!: Record<string, unknown>;

  @Property({ type: "timestamptz" })
  occurredAt: Date = new Date();

  @Property({ type: "integer", default: 0 })
  attempts: number = 0;

  @Property({ type: "timestamptz", nullable: true })
  nextAttemptAt?: Date;

  @Property({ type: "timestamptz", nullable: true })
  publishedAt?: Date;

  @Property({ type: "varchar", length: 64, nullable: true })
  claimToken?: string;

  @Property({ type: "timestamptz", nullable: true })
  claimUntil?: Date;
}
