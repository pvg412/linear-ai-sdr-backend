export function extractFolderMentions(text: string): { cleanedText: string; mentions: string[] } {
  const mentions: string[] = [];
  const re = /(^|\s)@([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})\b/g;

  let cleaned = text;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    mentions.push(m[2]);
  }

  // remove only "@xxx" tokens (keeping spaces)
  cleaned = cleaned.replace(re, "$1").replace(/\s{2,}/g, " ").trim();

  return { cleanedText: cleaned, mentions: Array.from(new Set(mentions)) };
}
