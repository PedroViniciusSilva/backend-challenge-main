import { defineConfig } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";
import { WalletEntity } from "./entities/WalletEntity";
import { WalletLedgerEntryEntity } from "./entities/WalletLedgerEntryEntity";
import { WagerTransactionEntity } from "./entities/WagerTransactionEntity";
import { InboxMessageEntity } from "./entities/InboxMessageEntity";
import { OutboxMessageEntity } from "./entities/OutboxMessageEntity";
import { Migration20261003000001 } from "./migrations/Migration20261003000001";
import { Migration20261003000002 } from "./migrations/Migration20261003000002";
import { Migration20261003000003 } from "./migrations/Migration20261003000003";
import { Migration20261003000004 } from "./migrations/Migration20261003000004";

export default defineConfig({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || "jungle_user",
  password: process.env.DB_PASSWORD || "jungle_password",
  dbName: process.env.DB_NAME || "wagering_db",

  entities: [
    WalletEntity,
    WalletLedgerEntryEntity,
    WagerTransactionEntity,
    InboxMessageEntity,
    OutboxMessageEntity,
  ],

  extensions: [Migrator],
  migrations: {
    tableName: "mikro_orm_migrations",
    transactional: true,
    allOrNothing: true,
    migrationsList: [
      {
        name: "Migration20261003000001",
        class: Migration20261003000001,
      },
      {
        name: "Migration20261003000002",
        class: Migration20261003000002,
      },
      {
        name: "Migration20261003000003",
        class: Migration20261003000003,
      },
      {
        name: "Migration20261003000004",
        class: Migration20261003000004,
      },
    ],
  },

  debug: false,
});
