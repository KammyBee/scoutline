import type { GmailMessage, GmailPart } from "./api";

/** What the classifier sees. `text` is held in memory only for this sync and never saved. */
export type MailIn = {
  id: string;
  threadId: string;
  date: string; // ISO
  fromName: string;
  fromAddress: string;
  subject: string;
  text: string;
  labels: string[];
};

export function header(m: GmailMessage, name: string): string {
  const h = m.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

/** "Acme Recruiting <jobs@acme.com>" → { name, address } */
export function parseFrom(v: string): { name: string; address: string } {
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), address: m[2].trim().toLowerCase() };
  return { name: "", address: v.trim().toLowerCase() };
}

function decode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&rsquo;|&apos;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#\d+;|&[a-z]+;/g, " ");
}

/** Plain text of the message: text/plain parts first, else HTML stripped. Skips attachments. */
export function bodyText(p: GmailPart | undefined, limit = 6000): string {
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (x: GmailPart | undefined) => {
    if (!x) return;
    if (x.filename || x.body?.attachmentId) return; // an attachment: never read
    if (x.body?.data) {
      if (x.mimeType === "text/plain") plain.push(decode(x.body.data));
      else if (x.mimeType === "text/html") html.push(htmlToText(decode(x.body.data)));
    }
    x.parts?.forEach(walk);
  };
  walk(p);
  const text = (plain.length ? plain.join("\n") : html.join("\n")).replace(/[ \t\r\f\v]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  return text.slice(0, limit);
}

export function toMailIn(m: GmailMessage): MailIn {
  const from = parseFrom(header(m, "From"));
  const internal = Number(m.internalDate);
  const hdrDate = Date.parse(header(m, "Date"));
  const date = new Date(isFinite(internal) && internal > 0 ? internal : isFinite(hdrDate) ? hdrDate : Date.now()).toISOString();
  return {
    id: m.id,
    threadId: m.threadId,
    date,
    fromName: from.name,
    fromAddress: from.address,
    subject: header(m, "Subject"),
    text: bodyText(m.payload) || m.snippet || "",
    labels: m.labelIds ?? [],
  };
}

/**
 * Removes things Scoutline must never store: phone numbers and money amounts (so offer salaries
 * never land in the database). Used on every subject and summary before saving.
 */
export function redact(s: string): string {
  return s
    .replace(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone]")
    .replace(/(?:USD\s?)?\$\s?\d+(?:,\d{3})*(?:\.\d+)?\s?(?:k|K|m|M)?\b(?:\s?(?:-|–|to)\s?\$?\s?\d+(?:,\d{3})*(?:\.\d+)?\s?(?:k|K)?)?/g, "[amount]")
    .replace(/\b(?:USD|US\$)\s?\d+(?:,\d{3})*(?:\.\d+)?\s?[kK]?\b/g, "[amount]")
    .replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b(?:\s?(?:USD|dollars))?/gi, "[amount]")
    .replace(/\b\d{2,3}\s?[kK]\b(?=\s*(?:-|–|to|per|\/|a year|annual|base|salary))/g, "[amount]");
}

export function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}
