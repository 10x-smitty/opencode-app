import { createOpencodeSession, promptOpencode } from "./opencode";

const BIO_MAX_LENGTH = 750;

function stripHtmlForPrompt(html: string) {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li)\s*>/gi, "\n");
  const stripped = withBreaks.replace(/<[^>]+>/g, "");
  return stripped
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function truncateAtWord(text: string, max: number) {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return `${slice.slice(0, lastSpace > 0 ? lastSpace : max).trimEnd()}…`;
}

export async function summarizeArtistBio(
  artistName: string,
  rawBio: string | null | undefined,
): Promise<string | null> {
  if (!rawBio) return null;
  const plain = stripHtmlForPrompt(rawBio);
  if (!plain) return null;
  if (plain.length <= BIO_MAX_LENGTH) return plain;

  const prompt = [
    `Rewrite the following artist bio for "${artistName}" in ${BIO_MAX_LENGTH} characters or less.`,
    "Output plain text only — no HTML, no markdown, no surrounding quotes, no preamble.",
    "Preserve the most important facts about the artist's career, style, and notable achievements.",
    "Use a neutral, encyclopedic tone.",
    "",
    "Bio:",
    plain,
  ].join("\n");

  try {
    const sessionId = await createOpencodeSession(`bio-summary:${artistName}`);
    const reply = await promptOpencode(sessionId, prompt);
    const cleaned = stripHtmlForPrompt(reply).replace(/^["'`]+|["'`]+$/g, "").trim();
    if (!cleaned) return truncateAtWord(plain, BIO_MAX_LENGTH);
    return cleaned.length > BIO_MAX_LENGTH ? truncateAtWord(cleaned, BIO_MAX_LENGTH) : cleaned;
  } catch (error) {
    console.warn("[bio-summary] summarization failed; falling back to truncated raw bio", error);
    return truncateAtWord(plain, BIO_MAX_LENGTH);
  }
}
