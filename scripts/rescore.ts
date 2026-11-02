import { migrateDb, openDb } from "../src/db/open";
import { rescoreAll } from "../src/lib/rescore";

// Usage: npm run rescore   re-checks every job's skill match (hits and gaps) and your "More like this" / "Not for me" signals.
async function main() {
  const db = await openDb();
  await migrateDb(db);
  const { updated: n } = await rescoreAll(db);
  console.log(`Updated the match for ${n} job${n === 1 ? "" : "s"}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
