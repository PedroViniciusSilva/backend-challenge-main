import { Entity, PrimaryKey, Property, Index } from "@mikro-orm/core";
import { LedgerDirection } from "../../../domain/models/WalletLedgerEntry";

@Entity({ tableName: "wallet_ledger_entries" })
@Index({ properties: ["walletId", "createdAt"] })
export class WalletLedgerEntryEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "uuid" })
  walletId!: string;

  @Property({ type: "uuid" })
  transactionId!: string;

  @Property({ type: "varchar", length: 10 })
  direction!: LedgerDirection;

  @Property({ type: "decimal", precision: 18, scale: 2 })
  amount!: string;

  @Property({ type: "varchar", length: 3 })
  currency!: string;

  @Property({ type: "decimal", precision: 18, scale: 2 })
  balanceBefore!: string;

  @Property({ type: "decimal", precision: 18, scale: 2 })
  balanceAfter!: string;

  @Property({ type: "timestamptz" })
  createdAt: Date = new Date();
}
