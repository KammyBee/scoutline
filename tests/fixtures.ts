import type { DashboardExport } from "@/lib/importDashboard";

/** A tiny made-up export in the dashboard's shape. No real data. */
export const sampleExport: DashboardExport = {
  format: "erp-job-pipeline-export",
  version: 1,
  jobs: [
    {
      id: "acme-erp-developer",
      num: 1,
      title: "ERP Developer",
      company: "Acme Manufacturing, Inc.",
      location: "Oakland, CA",
      mode: "hybrid",
      payMin: 110000,
      payMax: 140000,
      url: "https://jobs.example.com/acme/1",
      source: "Dice",
      posted: "2026-10-20",
      found: "2026-10-21",
      fit: 4,
      why: "Epicor and SQL overlap.",
      tags: ["Epicor", "SQL"],
      status: "applied",
      appliedAt: "2026-10-22",
      followUpAt: "2026-10-29",
      description: { text: "Build BPMs.", savedAt: "2026-10-21T10:00:00Z", sourceUrl: "https://jobs.example.com/acme/1" },
      kit: { resumeName: "Epicor", resumeUrl: "https://example.com/r", tips: ["Lead with Kinetic"] },
      activity: [{ date: "2026-10-22", kind: "applied", summary: "Acme confirmed the application.", link: "https://mail.example.com/1", emailId: "m1" }],
    },
    {
      id: "acme-erp-developer-dup",
      title: "ERP  Developer",
      company: "ACME Manufacturing",
      url: "https://jobs.example.com/acme/1",
      fit: 9,
      status: "weird-status",
      found: "not a date",
    },
    { id: "globex-bsa", title: "Business Systems Analyst", company: "Globex", status: "passed", passReason: "Too senior", fit: 2 },
    { id: "", title: "No id", company: "Nobody" },
  ],
  emails: [
    { id: "m1", jobId: "acme-erp-developer", date: "2026-10-22T16:00:00Z", from: "Acme", subject: "Thanks for applying", kind: "applied", summary: "Confirmation", state: "matched" },
    { id: "m2", jobId: "deleted-job", date: "2026-10-23T16:00:00Z", subject: "Other", kind: "update" },
  ],
  meta: {
    seen: {
      jobs: [
        { url: "https://jobs.example.com/acme/1", job: "Acme Manufacturing | ERP Developer" },
        { url: "https://jobs.example.com/initech/9", job: "Initech | SAP Analyst" },
        { url: "", job: "no separator here" },
      ],
    },
    answers: { linkedin: "https://linkedin.example/in/someone", updatedAt: "2026-10-01" },
  },
};
