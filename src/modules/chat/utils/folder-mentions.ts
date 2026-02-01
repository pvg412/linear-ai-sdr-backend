export function stripMentions(text: string): string {
  // Remove all @mentions from text
  // Match @word patterns that start after whitespace or at beginning (not emails)
  // Negative lookbehind (?<![A-Za-z0-9]) ensures @ is not preceded by alphanumeric (avoids emails)
  return text.replace(/(?<![A-Za-z0-9])@[0-9A-Za-z\u00C0-\u024F\u0400-\u052F_-]+/g, '').trim();
}

export function extractFolderMentions(text: string): {
  cleanedText: string;
  mentions: string[];
} {
  const mentions: string[] = [];
  const re = /(^|\s)@([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})\b/g;

  let cleaned = text;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    mentions.push(m[2]);
  }

  // remove only "@xxx" tokens (keeping spaces)
  cleaned = cleaned
    .replace(re, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { cleanedText: cleaned, mentions: Array.from(new Set(mentions)) };
}
