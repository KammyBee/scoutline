import { migrateDb, openDb } from "../src/db/open";
import { listCompanies, seedStarterList } from "../src/lib/companies";
import { checkAndScore } from "../src/lib/feeds/run";

// Usage: npm run fetch-jobs            check every active company on your watch list
//        npm run fetch-jobs -- --seed  add the starter watch list first (only if your list is empty)
async function main() {
  const db = await openDb();
  await migrateDb(db);
  if (process.argv.includes("--seed") && (await listCompanies(db)).length === 0) {
    console.log(`Added ${await seedStarterList(db)} companies from the starter watch list.`);
  }
  const t = Date.now();
  const s = await checkAndScore(db, { trigger: "script" });
  console.log(`Checked ${s.companiesChecked} job boards in ${Math.round((Date.now() - t) / 1000)}s: ${s.jobsSeen} open jobs, ${s.jobsMatched} matched your filters, ${s.added} new added to To review.`);
  for (const j of s.newJobs) console.log(`  + ${j.company}: ${j.title}`);
  if (s.duplicatesRemoved) console.log(`Removed ${s.duplicatesRemoved} duplicate job(s) from To review.`);
  if (s.claudeScored) console.log(`Claude scored ${s.claudeScored} of them and picked a resume for each.`);
  if (s.lettersDrafted) console.log(`Claude drafted ${s.lettersDrafted} cover letter(s) for the best matches. Review them before you apply.`);
  if (s.claudeNote) console.log(s.claudeNote);
  if (s.errors.length) {
    console.log(`${s.errors.length} board(s) had problems:`);
    for (const e of s.errors) console.log(`  ! ${e.company}: ${e.error}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
