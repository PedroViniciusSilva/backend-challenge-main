import { Migration } from "@mikro-orm/migrations";

export class Migration20261003000004 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "wallet_ledger_entries"
        ADD CONSTRAINT "uq_ledger_transaction_wallet"
          UNIQUE ("transaction_id", "wallet_id"),
        ADD CONSTRAINT "chk_ledger_amount_positive"
          CHECK ("amount" > 0),
        ADD CONSTRAINT "chk_ledger_balance_before_non_negative"
          CHECK ("balance_before" >= 0),
        ADD CONSTRAINT "chk_ledger_balance_after_non_negative"
          CHECK ("balance_after" >= 0),
        ADD CONSTRAINT "chk_ledger_direction"
          CHECK ("direction" IN ('DEBIT', 'CREDIT'));
    `);

    this.addSql(`
      ALTER TABLE "wager_transactions"
        ADD CONSTRAINT "chk_wager_amount_non_negative"
          CHECK ("amount" >= 0),
        ADD CONSTRAINT "chk_wager_status"
          CHECK ("status" IN ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')),
        ADD CONSTRAINT "chk_wager_kind"
          CHECK ("kind" IN ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'));
    `);

    this.addSql(`
      CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'wallet_ledger_entries is append-only';
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_ledger_no_update ON "wallet_ledger_entries";
      CREATE TRIGGER trg_ledger_no_update
        BEFORE UPDATE OR DELETE ON "wallet_ledger_entries"
        FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
    `);
  }

  async down(): Promise<void> {
    this.addSql(
      'DROP TRIGGER IF EXISTS trg_ledger_no_update ON "wallet_ledger_entries";',
    );
    this.addSql("DROP FUNCTION IF EXISTS prevent_ledger_mutation();");
    this.addSql(`
      ALTER TABLE "wager_transactions"
        DROP CONSTRAINT IF EXISTS "chk_wager_amount_non_negative",
        DROP CONSTRAINT IF EXISTS "chk_wager_status",
        DROP CONSTRAINT IF EXISTS "chk_wager_kind";
    `);
    this.addSql(`
      ALTER TABLE "wallet_ledger_entries"
        DROP CONSTRAINT IF EXISTS "uq_ledger_transaction_wallet",
        DROP CONSTRAINT IF EXISTS "chk_ledger_amount_positive",
        DROP CONSTRAINT IF EXISTS "chk_ledger_balance_before_non_negative",
        DROP CONSTRAINT IF EXISTS "chk_ledger_balance_after_non_negative",
        DROP CONSTRAINT IF EXISTS "chk_ledger_direction";
    `);
  }
}
