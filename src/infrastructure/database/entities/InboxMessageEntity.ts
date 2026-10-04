import { Entity, PrimaryKey, Property, Unique } from "@mikro-orm/core";

@Entity({ tableName: "inbox_messages" })
@Unique({ properties: ["consumerName", "messageId"] })
export class InboxMessageEntity {
  @PrimaryKey({ type: "varchar", length: 128 })
  messageId!: string;

  @Property({ type: "varchar", length: 64 })
  consumerName!: string;

  @Property({ type: "varchar", length: 64 })
  payloadHash!: string;

  @Property({ type: "timestamptz" })
  receivedAt: Date = new Date();

  @Property({ type: "timestamptz", nullable: true })
  processedAt?: Date;
}
