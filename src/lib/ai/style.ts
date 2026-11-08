// Pure text helpers, safe to import from client components.

/**
 * How letters and answers should sound. It describes a voice instead of only banning words, because a list of
 * banned words on its own just gets swapped for the next stock phrase.
 */
export const STYLE =
  "Voice: write it the way he'd write it himself in a quick, careful email to a hiring manager he respects. Plain words, contractions, first person. " +
  "Mix sentence lengths, and let paragraphs be uneven. It's fine for one to be a single sentence. " +
  "Be concrete: name the actual system, task, or result from his facts instead of describing qualities (say what he built or fixed, not that he is detail-oriented or a problem solver). " +
  "Open with something specific to this job or company, not with \"I'm writing to apply\" or a line about himself. " +
  "End on a short, plain line, not a summary of the letter and not a request for an interview. " +
  "Don't group things in threes out of habit, don't use rhetorical questions, and don't start sentences with Moreover, Furthermore, Additionally, or Ultimately. " +
  'Never use: "excited", "thrilled", "eager", "passionate", "leverage", "dynamic", "fast-paced", "I am confident", "delve", "testament", "align(s) with", "esteemed", ' +
  '"proven track record", "synergy", "seamless", "robust", "spearhead", "navigate", "landscape", "tapestry", "unique opportunity", "I believe I would be a great fit", ' +
  '"not only... but also", "I look forward to the opportunity", em dashes, semicolons, bullet points, bold text, or restating the job ad back to them.';

/** Phrases that read as machine-written. The letter panel points them out on a draft that slips through. */
export const STOCK_PHRASES = [
  "excited", "thrilled", "eager to", "passionate", "leverage", "dynamic", "fast-paced", "delve", "testament", "aligns with", "align with",
  "esteemed", "proven track record", "synergy", "seamless", "robust", "spearhead", "tapestry", "unique opportunity", "i look forward to the opportunity",
  "moreover", "furthermore", "additionally,",
];

/** Returns the stock phrases found in a draft, lowercase, so the UI or a test can point them out. */
export function stockPhrasesIn(text: string): string[] {
  const t = text.toLowerCase();
  return STOCK_PHRASES.filter((p) => t.includes(p));
}

/**
 * Cleans up typography that people rarely type into an application form: curly quotes, the ellipsis
 * character, em and en dashes. Doesn't touch wording.
 */
export function tidyDraft(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\s*\u2014\s*/g, ", ")
    .replace(/(\d)\s*\u2013\s*(\d)/g, "$1-$2")
    .replace(/\s*\u2013\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}
