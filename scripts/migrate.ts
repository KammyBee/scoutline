import { migrateDb, openDb } from "../src/db/open";

async function main() {
  const db = await openDb();
  await migrateDb(db);
  console.log(`Database is up to date (${process.env.DATABASE_URL ? "Postgres" : "local PGlite"}).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
