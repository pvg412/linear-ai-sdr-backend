// English comments by request

export function trimOrUndefined(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

export function composeFullName(input: {
  name?: unknown;
  firstName?: unknown;
  lastName?: unknown;
}): string | undefined {
  const name = trimOrUndefined(input.name);
  if (name) return name;

  const first = trimOrUndefined(input.firstName);
  const last = trimOrUndefined(input.lastName);

  const out = [first, last].filter(Boolean).join(" ");
  return out.length ? out : undefined;
}

export function joinLocationParts(parts: unknown[]): string | undefined {
  const cleaned = parts
    .map(trimOrUndefined)
    .filter(Boolean) as string[];
  return cleaned.length ? cleaned.join(", ") : undefined;
}

export function normalizeLinkedinUrl(url: unknown): string | undefined {
  const u = trimOrUndefined(url);
  if (!u) return undefined;

  // Keep it simple; do not over-normalize
  if (!u.startsWith("http://") && !u.startsWith("https://")) return u;
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    // keep query? usually not needed
    parsed.search = "";
    return parsed.toString();
  } catch {
    return u;
  }
}

export function normalizeDomain(domainOrUrl: unknown): string | undefined {
  const v = trimOrUndefined(domainOrUrl);
  if (!v) return undefined;

  // If it's an URL -> extract host
  if (v.startsWith("http://") || v.startsWith("https://")) {
    try {
      const u = new URL(v);
      return u.hostname.replace(/^www\./, "");
    } catch {
      return undefined;
    }
  }

  // If it's a domain already
  return v.replace(/^www\./, "");
}

export function pickFirstEmail(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    const t = trimOrUndefined(c);
    if (!t) continue;
    return t;
  }
  return undefined;
}
