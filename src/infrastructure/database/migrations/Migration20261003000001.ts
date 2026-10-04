import { Migration } from "@mikro-orm/migrations";

export class Migration20261003000001 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wallets" (
        "id" UUID PRIMARY KEY,
        "player_id" VARCHAR(64) NOT NULL,
        "currency" VARCHAR(3) NOT NULL,
        "balance" NUMERIC(18, 2) NOT NULL,
        "version" INTEGER NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "chk_wallets_balance_non_negative" CHECK ("balance" >= 0),
        CONSTRAINT "uq_wallets_player_currency" UNIQUE ("player_id", "currency")
      );
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wallet_ledger_entries" (
        "id" UUID PRIMARY KEY,
        "wallet_id" UUID NOT NULL REFERENCES "wallets"("id") ON DELETE RESTRICT,
        "transaction_id" UUID NOT NULL,
        "direction" VARCHAR(10) NOT NULL,
        "amount" NUMERIC(18, 2) NOT NULL,
        "currency" VARCHAR(3) NOT NULL,
        "balance_before" NUMERIC(18, 2) NOT NULL,
        "balance_after" NUMERIC(18, 2) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS "idx_ledger_wallet_created" ON "wallet_ledger_entries" ("wallet_id", "created_at");
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "wager_transactions" (
        "id" UUID PRIMARY KEY,
        "provider_id" VARCHAR(64) NOT NULL,
        "external_transaction_id" VARCHAR(128) NOT NULL,
        "idempotency_key" VARCHAR(256) NOT NULL,
        "payload_hash" VARCHAR(64) NOT NULL,
        "wallet_id" UUID NOT NULL REFERENCES "wallets"("id") ON DELETE RESTRICT,
        "player_id" VARCHAR(64) NOT NULL,
        "round_id" VARCHAR(64) NOT NULL,
        "game_id" VARCHAR(64) NOT NULL,
        "kind" VARCHAR(20) NOT NULL,
        "amount" NUMERIC(18, 2) NOT NULL,
        "currency" VARCHAR(3) NOT NULL,
        "status" VARCHAR(20) NOT NULL,
        "reference_external_transaction_id" VARCHAR(128),
        "reference_transaction_id" UUID,
        "failure_code" VARCHAR(64),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "processed_at" TIMESTAMPTZ,
        CONSTRAINT "uq_wager_transactions_idempotency" UNIQUE ("idempotency_key")
      );
      CREATE INDEX IF NOT EXISTS "idx_wager_tx_provider_ext" ON "wager_transactions" ("provider_id", "external_transaction_id");
      CREATE INDEX IF NOT EXISTS "idx_wager_tx_wallet_round" ON "wager_transactions" ("wallet_id", "round_id");
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "inbox_messages" (
        "message_id" VARCHAR(128) NOT NULL,
        "consumer_name" VARCHAR(64) NOT NULL,
        "payload_hash" VARCHAR(64) NOT NULL,
        "received_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "processed_at" TIMESTAMPTZ,
        PRIMARY KEY ("consumer_name", "message_id")
      );
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "outbox_messages" (
        "id" UUID PRIMARY KEY,
        "aggregate_id" VARCHAR(64) NOT NULL,
        "event_type" VARCHAR(64) NOT NULL,
        "payload" JSONB NOT NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "next_attempt_at" TIMESTAMPTZ,
        "published_at" TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS "idx_outbox_publish_queue" ON "outbox_messages" ("published_at", "next_attempt_at");
      ALTER TABLE "outbox_messages" ADD COLUMN IF NOT EXISTS "claim_token" VARCHAR(64);
      ALTER TABLE "outbox_messages" ADD COLUMN IF NOT EXISTS "claim_until" TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS "idx_outbox_claim" ON "outbox_messages" ("published_at", "claim_until");
    `);

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "pending_reference_retries" (
        "transaction_id" UUID PRIMARY KEY REFERENCES "wager_transactions"("id") ON DELETE CASCADE,
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "outbox_messages";');
    this.addSql('DROP TABLE IF EXISTS "inbox_messages";');
    this.addSql('DROP TABLE IF EXISTS "pending_reference_retries";');
    this.addSql('DROP TABLE IF EXISTS "wager_transactions";');
    this.addSql('DROP TABLE IF EXISTS "wallet_ledger_entries";');
    this.addSql('DROP TABLE IF EXISTS "wallets";');
  }
}
