import { Migration } from "@mikro-orm/migrations";

export class Migration20261003000003 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "pending_reference_retries" (
        "transaction_id" UUID PRIMARY KEY REFERENCES "wager_transactions"("id") ON DELETE CASCADE,
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "pending_reference_retries";');
  }
}
