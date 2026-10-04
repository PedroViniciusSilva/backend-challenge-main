import { Migration } from "@mikro-orm/migrations";

export class Migration20261003000002 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "outbox_messages"
        ADD COLUMN IF NOT EXISTS "claim_token" VARCHAR(64),
        ADD COLUMN IF NOT EXISTS "claim_until" TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS "idx_outbox_claim"
        ON "outbox_messages" ("published_at", "claim_until");
    `);
  }

  async down(): Promise<void> {
    this.addSql('DROP INDEX IF EXISTS "idx_outbox_claim";');
    this.addSql(
      'ALTER TABLE "outbox_messages" DROP COLUMN IF EXISTS "claim_until";',
    );
    this.addSql(
      'ALTER TABLE "outbox_messages" DROP COLUMN IF EXISTS "claim_token";',
    );
  }
}
