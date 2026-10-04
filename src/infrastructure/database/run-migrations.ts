import { MikroORM } from "@mikro-orm/postgresql";
import config from "./mikro-orm.config";

async function run() {
  console.log("==> Conectando ao PostgreSQL para rodar migrations...");

  const orm = await MikroORM.init(config);

  try {
    const migrator = orm.migrator;

    const migrations = await migrator.up();

    if (migrations.length === 0) {
      console.log(
        "==> Nenhuma migration pendente. O banco já está atualizado!",
      );
    } else {
      console.log(
        `==> ${migrations.length} migration(s) executada(s) com sucesso:`,
      );
      migrations.forEach((m) => console.log(`   - ${m.name}`));
    }
  } catch (error) {
    console.error("==> Erro ao executar migrations:", error);
    process.exit(1);
  } finally {
    await orm.close(true);
  }
}

run();
