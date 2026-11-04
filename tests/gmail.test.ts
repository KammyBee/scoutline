import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { addDays } from "@/lib/dates";
import { applyFollowUpRules, planFollowUps, recordFollowUp, type FollowState } from "@/lib/followups";
import { canDraft, canRead, clearTokenCacheForTests, getAccount, saveGrant } from "@/lib/google/account";
import { decryptSecret, encryptSecret } from "@/lib/google/crypto";
import { SCOPE_DRAFTS, SCOPE_READ, authUrl, readIdToken, scopesFor, type Fetcher } from "@/lib/google/oauth";
import { GmailApi, GmailBlocked, isAllowed, type GmailMessage } from "@/lib/gmail/api";
import { nextStatus } from "@/lib/gmail/apply";
import { classify, dueFrom, gmailQuery } from "@/lib/gmail/classify";
import { buildRaw, parseRecipients, saveDraft } from "@/lib/gmail/draft";
import { linkMessage, type Candidate } from "@/lib/gmail/link";
import { bodyText, redact, toMailIn, type MailIn } from "@/lib/gmail/parse";
import { syncGmail } from "@/lib/gmail/sync";

type Db = NodePgDatabase<typeof schema>;
const SECRET = "x".repeat(40);

async function freshDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: "drizzle" });
  return db;
}

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
  process.env.GOOGLE_CLIENT_ID = "client-123.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "shh";
  process.env.GOOGLE_ALLOWED_EMAIL = "me@example.com";
  process.env.APP_TIMEZONE = "America/Los_Angeles";
  clearTokenCacheForTests();
});
afterEach(() => {
  for (const k of ["GMAIL_SKIP_DOMAINS", "NO_RESPONSE_DAYS", "FOLLOW_UP_DAYS"]) delete process.env[k];
});

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
function mail(id: string, o: { from: string; subject: string; text?: string; html?: string; date: string; threadId?: string; labels?: string[]; attachment?: boolean }): GmailMessage {
  const parts = [];
  if (o.text !== undefined) parts.push({ mimeType: "text/plain", body: { data: b64(o.text) } });
  if (o.html !== undefined) parts.push({ mimeType: "text/html", body: { data: b64(o.html) } });
  if (o.attachment) parts.push({ mimeType: "application/pdf", filename: "offer.pdf", body: { attachmentId: "att1", size: 1000 } });
  return {
    id,
    threadId: o.threadId ?? "t-" + id,
    labelIds: o.labels ?? ["INBOX"],
    internalDate: String(Date.parse(o.date)),
    payload: { mimeType: "multipart/mixed", headers: [{ name: "From", value: o.from }, { name: "Subject", value: o.subject }, { name: "Date", value: new Date(o.date).toUTCString() }], parts },
  };
}
const asIn = (m: GmailMessage): MailIn => toMailIn(m);

describe("Google connection", () => {
  it("encrypts the refresh token and can't decrypt it with another secret", async () => {
    const box = await encryptSecret("1//refresh-token");
    expect(box).not.toContain("refresh");
    expect(await decryptSecret(box)).toBe("1//refresh-token");
    await expect(decryptSecret(box, "y".repeat(40))).rejects.toThrow();
  });
  it("asks only for email + gmail.readonly, and gmail.compose only for drafts", () => {
    expect(scopesFor("signin")).toEqual(["openid", "email", SCOPE_READ]);
    expect(scopesFor("connect")).not.toContain(SCOPE_DRAFTS);
    expect(scopesFor("drafts")).toContain(SCOPE_DRAFTS);
    for (const p of ["signin", "connect", "drafts"] as const) {
      expect(scopesFor(p).join(" ")).not.toMatch(/gmail\.modify|gmail\.send|gmail\.labels|mail\.google\.com/);
    }
    const u = new URL(authUrl({ purpose: "connect", state: "s", challenge: "c", redirectUri: "http://localhost:3000/auth/google/callback" }));
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("access_type")).toBe("offline");
  });
  it("checks the ID token's issuer, audience and expiry", () => {
    const tok = (c: object) => "h." + Buffer.from(JSON.stringify(c)).toString("base64url") + ".sig";
    const exp = Math.floor(Date.now() / 1000) + 600;
    expect(readIdToken(tok({ iss: "https://accounts.google.com", aud: process.env.GOOGLE_CLIENT_ID, exp, email: "Me@Example.com", email_verified: true }))).toEqual({ email: "me@example.com", emailVerified: true });
    expect(() => readIdToken(tok({ iss: "https://evil.example", aud: process.env.GOOGLE_CLIENT_ID, exp }))).toThrow();
    expect(() => readIdToken(tok({ iss: "accounts.google.com", aud: "someone-else", exp }))).toThrow();
    expect(() => readIdToken(tok({ iss: "accounts.google.com", aud: process.env.GOOGLE_CLIENT_ID, exp: 1000 }))).toThrow();
  });
});

describe("Gmail is read-only (drafts aside)", () => {
  const B = "https://gmail.googleapis.com/gmail/v1/users/me/";
  it("allows only listing, reading and creating drafts", () => {
    expect(isAllowed("GET", B + "messages?q=x")).toBe(true);
    expect(isAllowed("GET", B + "messages/abc123?format=full")).toBe(true);
    expect(isAllowed("POST", B + "drafts")).toBe(true);
    expect(isAllowed("POST", B + "messages/send")).toBe(false);
    expect(isAllowed("POST", B + "drafts/send")).toBe(false);
    expect(isAllowed("POST", B + "messages/abc/modify")).toBe(false);
    expect(isAllowed("POST", B + "messages/abc/trash")).toBe(false);
    expect(isAllowed("DELETE", B + "messages/abc")).toBe(false);
    expect(isAllowed("POST", B + "messages/batchModify")).toBe(false);
    expect(isAllowed("POST", B + "labels")).toBe(false);
    expect(isAllowed("GET", B + "messages/abc/attachments/att1")).toBe(false);
    expect(isAllowed("POST", B + "threads/abc/modify")).toBe(false);
    expect(isAllowed("GET", "https://evil.example/gmail/v1/users/me/messages")).toBe(false);
  });
  it("refuses a blocked call before it reaches the network", async () => {
    const calls: string[] = [];
    const api = new GmailApi("tok", async (u) => { calls.push(u); return new Response("{}"); });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect((api as any).call("POST", "messages/send", {})).rejects.toBeInstanceOf(GmailBlocked);
    expect(calls).toEqual([]);
  });
});

describe("reading a message", () => {
  it("uses the text part, never attachments, and falls back to HTML", () => {
    expect(bodyText(mail("a", { from: "x@y.com", subject: "s", text: "Hello there", attachment: true, date: "2026-10-01" }).payload)).toBe("Hello there");
    expect(bodyText(mail("b", { from: "x@y.com", subject: "s", html: "<p>Hi&nbsp;<b>Kam</b></p><style>.x{}</style>", date: "2026-10-01" }).payload)).toBe("Hi Kam");
  });
  it("strips phone numbers and money amounts", () => {
    const r = redact("Call me at (415) 555-0134 or +1 650.555.0199. Base salary $145,000 - $160,000, or 150k per year, USD 120,000.");
    expect(r).not.toMatch(/555|145|160|150k|120,000/);
    expect(r).toContain("[phone]");
    expect(r).toContain("[amount]");
    expect(redact("Interview on 10/22 at 3pm for req 12345")).toBe("Interview on 10/22 at 3pm for req 12345");
  });
});

describe("classifying job email", () => {
  const m = (subject: string, text: string, from = "Acme Talent <no-reply@acme.com>", labels = ["INBOX"]) => asIn(mail("x", { from, subject, text, date: "2026-10-20T17:00:00Z", labels }));
  it("tells the kinds apart", () => {
    expect(classify(m("Thank you for applying to Acme", "We have received your application for ERP Developer."))?.kind).toBe("applied");
    expect(classify(m("Your application to Acme", "Thank you for applying. Unfortunately, we have decided to move forward with other candidates."))?.kind).toBe("rejection");
    expect(classify(m("Next steps with Acme", "We'd love to schedule an interview. Please share your availability."))?.kind).toBe("interview");
    const a = classify(m("Acme assessment", "Please complete the HackerRank coding challenge within 3 days of your application."));
    expect(a).toEqual({ kind: "action", actionText: "Complete the assessment", due: "2026-10-23" });
    expect(classify(m("Your offer from Acme", "We are pleased to extend an offer of employment."))?.kind).toBe("offer");
    expect(classify(m("Quick question", "Hi Kam, I'm a recruiter at Initech and came across your profile. Would you be open to a new role?", "Pat Lee <pat@initech.com>"))?.kind).toBe("recruiter");
  });
  it("ignores alerts, newsletters, personal mail and sent mail", () => {
    expect(classify(m("30 new jobs for ERP Developer", "Jobs you may be interested in", "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>"))).toBeNull();
    expect(classify(m("Dinner Saturday?", "Want to get tacos?", "Friend <friend@gmail.com>"))).toBeNull();
    expect(classify(m("Thank you for applying", "We have received your application.", "Me <me@example.com>", ["SENT"]))).toBeNull();
  });
  it("reads due dates and builds a narrow Gmail search", () => {
    expect(dueFrom("please reply within five business days", "2026-10-20T10:00:00Z")).toBe("2026-10-27");
    expect(dueFrom("no deadline", "2026-10-20")).toBeNull();
    const q = gmailQuery(1790000000);
    expect(q).toMatch(/^after:1790000000 -in:sent -in:drafts/);
    expect(q).toContain("-category:promotions");
  });
});

describe("matching email to a job", () => {
  const jobs: Candidate[] = [
    { id: "acme-erp", company: "Acme Manufacturing, Inc.", title: "ERP Developer", status: "applied", appliedAt: "2026-10-10" },
    { id: "acme-bsa", company: "Acme Manufacturing", title: "Business Systems Analyst", status: "applied", appliedAt: "2026-10-12" },
    { id: "globex", company: "Globex", title: "SAP Analyst", status: "applied", appliedAt: "2026-10-11" },
    { id: "initech", company: "Initech", title: "BI Developer", status: "new", appliedAt: null },
  ];
  const m = (from: string, subject: string, text = "") => asIn(mail("x", { from, subject, text, date: "2026-10-20" }));
  it("uses the company name, the sender's domain and the job title", () => {
    expect(linkMessage(m("Globex Recruiting <no-reply@greenhouse.io>", "Thank you for applying"), jobs)?.postingId).toBe("globex");
    expect(linkMessage(m("Careers <careers@initech.com>", "Your application"), jobs)?.postingId).toBe("initech");
    expect(linkMessage(m("no-reply@us.greenhouse-mail.io", "Acme Manufacturing: Business Systems Analyst"), jobs)?.postingId).toBe("acme-bsa");
    // Same company, no title: the most recent application wins.
    expect(linkMessage(m("Acme Manufacturing <jobs@acmemanufacturing.com>", "Application update"), jobs)?.postingId).toBe("acme-bsa");
  });
  it("returns nothing when it can't tell, and keeps replies with their thread", () => {
    expect(linkMessage(m("Recruiter <r@agency.com>", "Roles at Globex and Initech"), jobs)).toBeNull();
    expect(linkMessage(m("Someone <s@gmail.com>", "Hello"), jobs)).toBeNull();
    expect(linkMessage(m("Someone <s@gmail.com>", "Re: chat"), jobs, "globex")?.postingId).toBe("globex");
  });
});

describe("status changes from email", () => {
  it("only moves forward, and never touches a passed job", () => {
    expect(nextStatus("saved", "applied")).toBe("applied");
    expect(nextStatus("interviewing", "applied")).toBeNull();
    expect(nextStatus("applied", "interview")).toBe("interviewing");
    expect(nextStatus("interviewing", "rejection")).toBe("rejected");
    expect(nextStatus("offer", "rejection")).toBeNull();
    expect(nextStatus("noresponse", "update")).toBe("applied");
    expect(nextStatus("passed", "offer")).toBeNull();
  });
});

describe("follow-up rules", () => {
  const today = "2026-11-03";
  const row = (o: Partial<FollowState>): FollowState => ({ postingId: "p", company: "Acme", title: "ERP Developer", status: "applied", appliedAt: "2026-10-25", followUpAt: "2026-11-01", events: [], ...o });
  const cfg = { noResponse: 30, quiet: 14 };
  it("flags due follow-ups, marks no response after 30 quiet days, and nudges quiet interviews", () => {
    expect(planFollowUps([row({})], today, cfg).due[0].reason).toBe("No reply 9 days after applying");
    expect(planFollowUps([row({ followUpAt: "2026-11-05" })], today, cfg).due).toEqual([]);
    expect(planFollowUps([row({ appliedAt: "2026-10-01" })], today, cfg).markNoResponse).toEqual([{ postingId: "p", days: 33 }]);
    // Hearing back, or following up recently, means it isn't "no response".
    expect(planFollowUps([row({ appliedAt: "2026-10-01", events: [{ date: "2026-10-05", kind: "update" }] })], today, cfg).markNoResponse).toEqual([]);
    expect(planFollowUps([row({ appliedAt: "2026-10-01", events: [{ date: "2026-10-20", kind: "followup" }] })], today, cfg).markNoResponse).toEqual([]);
    expect(planFollowUps([row({ appliedAt: "2026-10-01" })], today, { noResponse: 0, quiet: 14 }).markNoResponse).toEqual([]);
    const quiet = planFollowUps([row({ status: "interviewing", followUpAt: null, events: [{ date: "2026-10-15", kind: "interview" }] })], today, cfg);
    expect(quiet.due[0].reason).toBe("No word for 19 days while interviewing");
  });
});

describe("drafts", () => {
  it("builds a plain-text message with no header injection", () => {
    const raw = buildRaw({ from: "me@example.com", to: parseRecipients("a@acme.com, bad address, b@acme.com\nBcc: x@evil.com"), subject: "Hi\r\nBcc: x@evil.com", body: "Thanks ✓" });
    const text = Buffer.from(raw, "base64url").toString("utf8");
    expect(text).toContain("To: a@acme.com, b@acme.com, x@evil.com\r\n"); // stays inside the To line
    expect(text).not.toMatch(/^Bcc:/m);
    expect(text).toContain("Subject: Hi Bcc: x@evil.com");
    const body = text.split("\r\n\r\n")[1];
    expect(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8")).toBe("Thanks ✓");
  });
  it("needs the drafts permission", async () => {
    const db = await freshDb();
    await saveGrant(db, "me@example.com", { access_token: "at", expires_in: 3600, refresh_token: "rt", scope: SCOPE_READ });
    await expect(saveDraft(db, { to: "", subject: "s", body: "b" })).rejects.toThrow(/Turn on Gmail drafts/);
  });
});

describe("Gmail sync", () => {
  const ACCT = "me@example.com";
  async function setup() {
    const db = await freshDb();
    const add = async (id: string, company: string, title: string, status: schema.Status, appliedAt: string | null) => {
      await db.insert(schema.postings).values({ id, title, company, dedupeKey: company.toLowerCase() + "|" + title.toLowerCase() });
      await db.insert(schema.applications).values({ postingId: id, status, appliedAt, followUpAt: appliedAt ? addDays(appliedAt, 7) : null });
    };
    await add("acme-erp", "Acme Manufacturing", "ERP Developer", "saved", null);
    await add("globex-sap", "Globex", "SAP Analyst", "applied", "2026-10-10");
    await add("initech-bi", "Initech", "BI Developer", "applied", "2026-10-12");
    await add("hooli-old", "Hooli", "Systems Analyst", "applied", "2026-09-20");
    return db;
  }
  const inbox: GmailMessage[] = [
    mail("m1", { from: "Acme Manufacturing <no-reply@greenhouse.io>", subject: "Thank you for applying to Acme Manufacturing", text: "We received your application for ERP Developer. Questions? Call (415) 555-0134.", date: "2026-10-28T16:00:00Z" }),
    mail("m2", { from: "Globex Talent <talent@globex.com>", subject: "Interview with Globex", text: "We'd like to schedule an interview. Please send your availability within 2 days.", date: "2026-10-29T18:00:00Z" }),
    mail("m3", { from: "Initech Careers <no-reply@initech.com>", subject: "Your application", text: "Thank you for applying. Unfortunately we are moving forward with other candidates.", date: "2026-10-30T18:00:00Z" }),
    mail("m4", { from: "Pat Lee <pat@umbrella-staffing.com>", subject: "Opportunity: ERP role", text: "I'm a recruiter and came across your profile. Would you be open to a contract role? Pays $70/hour.", date: "2026-10-31T18:00:00Z" }),
    mail("m5", { from: "Boss <boss@mycompany.com>", subject: "Re: interview schedule for the new hire", text: "Can you sit in on the interview?", date: "2026-10-31T19:00:00Z" }),
    mail("m6", { from: "LinkedIn <jobalerts-noreply@linkedin.com>", subject: "New jobs for ERP Developer", text: "Jobs you may be interested in", date: "2026-11-01T18:00:00Z" }),
    mail("m7", { from: "Globex Talent <talent@globex.com>", subject: "Re: Interview with Globex", text: "Great, see you then.", date: "2026-11-01T19:00:00Z", threadId: "t-m2" }),
    mail("m8", { from: "Acme <offers@acme.com>", subject: "Your offer", text: "We are pleased to extend an offer. Base salary $150,000.", date: "2026-11-02T18:00:00Z", attachment: true }),
  ];
  function fakeGoogle(messages: GmailMessage[]) {
    const calls: { method: string; url: string }[] = [];
    const fetcher: Fetcher = async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, url });
      if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "at-" + calls.length, expires_in: 3600 });
      const u = new URL(url);
      if (u.pathname.endsWith("/messages")) return Response.json({ messages: [...messages].reverse().map((m) => ({ id: m.id, threadId: m.threadId })) });
      const id = u.pathname.split("/").pop();
      const m = messages.find((x) => x.id === id);
      return m ? Response.json(m) : new Response("not found", { status: 404 });
    };
    return { fetcher, calls };
  }

  it("files job mail, moves statuses, and saves no bodies, phones or salaries", async () => {
    const db = await setup();
    await saveGrant(db, ACCT, { access_token: "at0", expires_in: 3600, refresh_token: "rt", scope: `openid email ${SCOPE_READ}` });
    clearTokenCacheForTests();
    process.env.GMAIL_SKIP_DOMAINS = "mycompany.com";
    const g = fakeGoogle(inbox);
    const s = await syncGmail(db, { fetcher: g.fetcher, now: new Date("2026-11-03T20:00:00Z") });
    expect(s).toMatchObject({ read: 8, matched: 5, unmatched: 1, statusChanges: 4, rateLimited: false });

    // Only token refresh, message listing and message reads. Nothing that writes.
    for (const c of g.calls) {
      if (c.url.startsWith("https://oauth2.googleapis.com/")) continue;
      expect(c.method).toBe("GET");
      expect(isAllowed(c.method, c.url)).toBe(true);
    }
    expect(g.calls.some((c) => c.url.includes("attachments"))).toBe(false);

    const apps = Object.fromEntries((await db.select().from(schema.applications)).map((a) => [a.postingId, a]));
    expect(apps["acme-erp"].status).toBe("offer");
    expect(apps["acme-erp"].appliedAt).toBe("2026-10-28");
    expect(apps["acme-erp"].actionNeeded).toMatchObject({ text: "Review the offer", done: false });
    expect(apps["globex-sap"].status).toBe("interviewing");
    expect(apps["globex-sap"].actionNeeded).toMatchObject({ text: "Reply with your availability", due: "2026-10-31" });
    expect(apps["initech-bi"].status).toBe("rejected");
    // Applied Sep 20, no email since: the 30-day rule marks it.
    expect(apps["hooli-old"].status).toBe("noresponse");

    const saved = await db.select().from(schema.emails);
    expect(saved.map((e) => e.id).sort()).toEqual(["m1", "m2", "m3", "m4", "m7", "m8"]);
    const all = JSON.stringify(saved);
    expect(all).not.toMatch(/555|150,000|\$70|Unfortunately|pleased to extend|see you then|mycompany|offer\.pdf/i);
    const m7 = saved.find((e) => e.id === "m7")!;
    expect(m7.postingId).toBe("globex-sap"); // same thread as the interview email
    const m4 = saved.find((e) => e.id === "m4")!;
    expect(m4).toMatchObject({ state: "unmatched", kind: "recruiter", postingId: null });
    expect(m4.link).toBe("https://mail.google.com/mail/u/me%40example.com/#all/m4");

    const evs = await db.select().from(schema.events).where(eq(schema.events.postingId, "acme-erp"));
    expect(evs.map((e) => e.kind).sort()).toEqual(["applied", "offer"]);
    expect(evs.find((e) => e.kind === "offer")?.summary).toBe("Acme Manufacturing sent an offer.");

    const acct = await getAccount(db);
    expect(acct).toMatchObject({ lastSyncStatus: "ok" });
    expect(acct?.refreshTokenEnc).not.toContain("rt");

    // A second run reads nothing new and changes nothing.
    const again = await syncGmail(db, { fetcher: g.fetcher, now: new Date("2026-11-03T21:00:00Z") });
    expect(again).toMatchObject({ read: 2, saved: 0, statusChanges: 0 }); // only the two skipped non-job messages are re-read
    expect((await db.select().from(schema.events)).length).toBe(evs.length + 4); // globex x2, initech, hooli no-response
  });

  it("backs off when Google says too fast, keeps what it read, and finishes on the next run", async () => {
    const db = await setup();
    await saveGrant(db, ACCT, { access_token: "at0", expires_in: 3600, refresh_token: "rt", scope: SCOPE_READ });
    clearTokenCacheForTests();
    const g = fakeGoogle(inbox);
    let limited = true;
    const waits: number[] = [];
    const fetcher: Fetcher = async (url, init) => {
      if (limited && url.includes("/messages/m4")) {
        return Response.json({ error: { code: 403, message: "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user'" } }, { status: 403 });
      }
      return g.fetcher(url, init);
    };
    const sleep = async (ms: number) => { waits.push(ms); };
    const first = await syncGmail(db, { fetcher, sleep, now: new Date("2026-11-03T20:00:00Z") });
    expect(first).toMatchObject({ rateLimited: true, more: true, read: 3 }); // m1-m3, oldest first, stops before m4
    expect(waits).toEqual([2000, 6000, 15000]);
    expect(Date.parse((await getAccount(db))!.syncedThrough!)).toBe(Date.parse("2026-10-30T18:00:00Z"));
    limited = false;
    const second = await syncGmail(db, { fetcher, sleep, now: new Date("2026-11-03T20:05:00Z") });
    expect(second.rateLimited).toBe(false);
    const saved = (await db.select().from(schema.emails)).map((e) => e.id).sort();
    expect(saved).toEqual(["m1", "m2", "m3", "m4", "m7", "m8"]);
  });

  it("marks the account for reconnect when Google revokes access", async () => {
    const db = await setup();
    await saveGrant(db, ACCT, { access_token: "at0", expires_in: 3600, refresh_token: "rt", scope: SCOPE_READ });
    clearTokenCacheForTests();
    const fetcher: Fetcher = async () => Response.json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 });
    await expect(syncGmail(db, { fetcher })).rejects.toThrow(/revoked/);
    const a = await getAccount(db);
    expect(a?.lastSyncStatus).toBe("reconnect");
    expect(canRead(a)).toBe(true);
    expect(canDraft(a)).toBe(false);
  });

  it("logs follow-ups and resets the clock", async () => {
    const db = await setup();
    await recordFollowUp(db, "globex-sap", "2026-11-03");
    const [a] = await db.select().from(schema.applications).where(eq(schema.applications.postingId, "globex-sap"));
    expect(a.followUpAt).toBe("2026-11-10");
    const plan = await applyFollowUpRules(db, "2026-11-03");
    expect(plan.markNoResponse.map((m) => m.postingId)).toEqual(["hooli-old"]);
    expect(plan.due.map((d) => d.postingId)).toEqual(["initech-bi"]);
  });
});
