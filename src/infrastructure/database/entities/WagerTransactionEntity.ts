import { Entity, PrimaryKey, Property, Unique, Index } from "@mikro-orm/core";
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../../domain/models/WagerTransaction";
import { FailureCode } from "../../../domain/errors/DomainError";

@Entity({ tableName: "wager_transactions" })
@Unique({ properties: ["idempotencyKey"] })
@Index({ properties: ["providerId", "externalTransactionId"] })
@Index({ properties: ["walletId", "roundId"] })
export class WagerTransactionEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "varchar", length: 64 })
  providerId!: string;

  @Property({ type: "varchar", length: 128 })
  externalTransactionId!: string;

  @Property({ type: "varchar", length: 256 })
  idempotencyKey!: string;

  @Property({ type: "varchar", length: 64 })
  payloadHash!: string;

  @Property({ type: "uuid" })
  walletId!: string;

  @Property({ type: "varchar", length: 64 })
  playerId!: string;

  @Property({ type: "varchar", length: 64 })
  roundId!: string;

  @Property({ type: "varchar", length: 64 })
  gameId!: string;

  @Property({ type: "varchar", length: 20 })
  kind!: WagerTransactionKind;

  @Property({ type: "decimal", precision: 18, scale: 2 })
  amount!: string;

  @Property({ type: "varchar", length: 3 })
  currency!: string;

  @Property({ type: "varchar", length: 20 })
  status!: WagerTransactionStatus;

  @Property({ type: "varchar", length: 128, nullable: true })
  referenceExternalTransactionId?: string;

  @Property({ type: "uuid", nullable: true })
  referenceTransactionId?: string;

  @Property({ type: "varchar", length: 64, nullable: true })
  failureCode?: FailureCode;

  @Property({ type: "timestamptz" })
  createdAt: Date = new Date();

  @Property({ type: "timestamptz", nullable: true })
  processedAt?: Date;
}
