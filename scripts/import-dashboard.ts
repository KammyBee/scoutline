import { readFileSync } from "node:fs";
import { migrateDb, openDb } from "../src/db/open";
import { mapExport, type DashboardExport } from "../src/lib/importDashboard";
import { writeImport } from "../src/lib/writeImport";

// Usage: npm run import -- data/dashboard-export.json [--update]
async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--")) ?? "data/dashboard-export.json";
  const update = args.includes("--update");
  const exp = JSON.parse(readFileSync(file, "utf8")) as DashboardExport;
  const mapped = mapExport(exp);
  const db = await openDb();
  await migrateDb(db);
  const counts = await writeImport(db, mapped, { update });
  console.log(`Read ${exp.jobs.length} jobs and ${exp.emails?.length ?? 0} emails from ${file}.`);
  console.log(`${update ? "Wrote" : "Added"}: ${counts.postings} postings (incl. archived "seen" roles), ${counts.applications} applications, ${counts.events} history events, ${counts.emails} emails, ${counts.feedback} pass reasons.`);
  if (mapped.warnings.length) console.log("Notes:\n- " + mapped.warnings.join("\n- "));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
