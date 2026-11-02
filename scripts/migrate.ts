import { migrateDb, openDb } from "../src/db/open";
import { rescoreAll } from "../src/lib/rescore";

async function main() {
  const db = await openDb();
  await migrateDb(db);
  const { updated } = await rescoreAll(db);
  if (updated) console.log(`Refreshed the skill match for ${updated} job${updated === 1 ? "" : "s"}.`);
  console.log(`Database is up to date (${process.env.DATABASE_URL ? "Postgres" : "local PGlite"}).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
