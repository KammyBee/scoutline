import { migrateDb, openDb } from "../src/db/open";
import { hideDuplicates } from "../src/lib/dupes";

// Usage: npm run dedupe            lists second copies of jobs sitting in To review or Saved
//        npm run dedupe -- --apply removes them (each check also does this on its own)
async function main() {
  const apply = process.argv.includes("--apply");
  const db = await openDb();
  await migrateDb(db);
  const dupes = await hideDuplicates(db, apply);
  for (const d of dupes) console.log(`  ${apply ? "-" : "?"} ${d.company}: ${d.title}  (same job as ${d.keptId})`);
  console.log(dupes.length ? `${apply ? "Removed" : "Found"} ${dupes.length} duplicate${dupes.length === 1 ? "" : "s"}.${apply ? "" : " Run with -- --apply to remove them."}` : "No duplicates in To review or Saved.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
