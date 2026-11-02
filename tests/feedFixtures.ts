// Made-up responses in the shapes the three job board APIs return. No real postings.

export const greenhouseList = {
  jobs: [
    { id: 101, title: "Business Systems Analyst, NetSuite", absolute_url: "https://job-boards.greenhouse.io/acmehw/jobs/101", location: { name: "San Francisco, CA" }, first_published: "2026-10-28T10:00:00-07:00", updated_at: "2026-10-30T10:00:00-07:00" },
    { id: 102, title: "Senior ERP Engineer", absolute_url: "https://job-boards.greenhouse.io/acmehw/jobs/102", location: { name: "Remote - US" }, updated_at: "2026-10-29T10:00:00-07:00" },
    { id: 103, title: "Account Executive", absolute_url: "https://job-boards.greenhouse.io/acmehw/jobs/103", location: { name: "Remote - US" }, updated_at: "2026-10-29T10:00:00-07:00" },
    { id: 104, title: "Integration Engineer", absolute_url: "https://job-boards.greenhouse.io/acmehw/jobs/104", location: { name: "London, UK" }, updated_at: "2026-10-29T10:00:00-07:00" },
    { id: 105, title: "Software Engineer II, Internal Tools", absolute_url: "https://job-boards.greenhouse.io/acmehw/jobs/105", location: { name: "Remote (United States)" }, updated_at: "2026-08-01T10:00:00-07:00" },
    { id: 106, title: "Application Support Analyst", absolute_url: "https://job-boards.greenhouse.io/acmehw/jobs/106", location: { name: "Hybrid - Fremont, CA" }, updated_at: "2026-10-31T09:00:00-07:00" },
  ],
  meta: { total: 6 },
};

export const greenhouseJob101 = {
  id: 101,
  title: "Business Systems Analyst, NetSuite",
  content: "&lt;p&gt;Own our &lt;strong&gt;NetSuite&lt;/strong&gt; ERP.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;SQL&lt;/li&gt;&lt;li&gt;Integrations &amp;amp; APIs&lt;/li&gt;&lt;/ul&gt;",
};

export const leverList = [
  {
    id: "aaaa-1111",
    text: "ERP Developer (Epicor)",
    hostedUrl: "https://jobs.lever.co/robocorp/aaaa-1111",
    createdAt: Date.parse("2026-10-25T12:00:00Z"),
    workplaceType: "remote",
    country: "US",
    categories: { location: "Remote", commitment: "Full-time", team: "IT" },
    descriptionPlain: "Build BPMs and BAQs in Epicor Kinetic.",
    lists: [{ text: "Requirements", content: "<li>SQL Server</li><li>C#</li>" }],
    additionalPlain: "",
    salaryRange: { min: 110000, max: 140000, currency: "USD", interval: "per-year-salary" },
  },
  {
    id: "bbbb-2222",
    text: "Manufacturing Systems Analyst",
    hostedUrl: "https://jobs.lever.co/robocorp/bbbb-2222",
    createdAt: Date.parse("2026-10-30T12:00:00Z"),
    workplaceType: "on-site",
    country: "US",
    categories: { location: "Austin, TX", commitment: "Full-time" },
    descriptionPlain: "MES and SAP.",
  },
];

export const ashbyList = {
  jobs: [
    {
      id: "ash-1",
      title: "Finance Systems Analyst",
      location: "San Francisco",
      secondaryLocations: [{ location: "Remote - US" }],
      isListed: true,
      isRemote: false,
      workplaceType: "Hybrid",
      descriptionPlain: "Own NetSuite, Workday and integrations.",
      publishedAt: "2026-10-29T18:00:00.000Z",
      employmentType: "FullTime",
      jobUrl: "https://jobs.ashbyhq.com/chipco/ash-1",
      address: { postalAddress: { addressCountry: "USA", addressLocality: "San Francisco", addressRegion: "California" } },
      compensation: { compensationTierSummary: "$130K – $165K • Offers Equity" },
    },
    { id: "ash-2", title: "Business Systems Engineer", location: "Remote", isListed: false, jobUrl: "https://jobs.ashbyhq.com/chipco/ash-2", publishedAt: "2026-10-29T18:00:00.000Z" },
  ],
};
