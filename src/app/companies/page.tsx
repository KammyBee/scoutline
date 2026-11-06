import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/db/client";
import { Header } from "@/components/Header";
import { CompanyList } from "@/components/CompanyList";
import { listCompanies } from "@/lib/companies";
import { SMALLER_COMPANIES, STARTER_WATCHLIST } from "@/lib/feeds/watchlist";

export const metadata = { title: "Watch list · Scoutline" };
export const maxDuration = 300;

async function Companies() {
  await connection();
  const rows = await listCompanies(await getDb());
  const have = new Set(rows.map((r) => r.name));
  const missingStarter = STARTER_WATCHLIST.filter((s) => !have.has(s.name)).length;
  const missingSmaller = SMALLER_COMPANIES.filter((s) => !have.has(s.name)).length;
  return <CompanyList companies={rows} missingStarter={missingStarter} missingSmaller={missingSmaller} />;
}

export default function CompaniesPage() {
  return (
    <div className="wrap">
      <Header current="companies" />
      <Suspense fallback={<div className="panel empty skeleton"><h2>Loading your watch list</h2></div>}>
        <Companies />
      </Suspense>
    </div>
  );
}
