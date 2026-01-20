import { inject, injectable } from "inversify";

import { LEAD_DIRECTORY_TYPES } from "../lead-directory.types";
import { LeadDirectoryRepository } from "../persistence/lead-directory.repository";
import {
  UNASSIGNED_DIRECTORY_ID,
  UNASSIGNED_DIRECTORY_NAME,
} from "../lead-directory.unassigned";

export type ResolveMentionsResult = {
  directoryIds: string[];
  missing: string[];
  ambiguous: string[];
};

export interface LeadDirectoryMentionResolver {
  resolve(ownerId: string, mentions: string[]): Promise<ResolveMentionsResult>;
}

function normalizeToken(s: string): string {
  return s.trim().toLowerCase();
}

function addMap(
  map: Map<string, Set<string>>,
  key: string,
  directoryId: string,
) {
  const k = normalizeToken(key);
  if (!k) return;
  const set = map.get(k) ?? new Set<string>();
  set.add(directoryId);
  map.set(k, set);
}

function slugVariantsFromName(name: string): string[] {
  const base = name.trim().toLowerCase();
  if (!base) return [];

  const withUnderscore = base
    .replace(/['"`]+/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const withDash = withUnderscore.replace(/_+/g, "-");
  const compact = withUnderscore.replace(/_+/g, "");

  const out = new Set<string>();
  for (const v of [withUnderscore, withDash, compact]) {
    if (!v) continue;
    if (!/^[a-z0-9]/.test(v)) continue; // matches your regex for @mention
    out.add(v.slice(0, 64));
  }
  return Array.from(out);
}

@injectable()
export class LeadDirectoryMentionResolverService implements LeadDirectoryMentionResolver {
  constructor(
    @inject(LEAD_DIRECTORY_TYPES.LeadDirectoryRepository)
    private readonly repo: LeadDirectoryRepository,
  ) {}

  async resolve(
    ownerId: string,
    mentions: string[],
  ): Promise<ResolveMentionsResult> {
    const uniqMentions = Array.from(
      new Set(mentions.map(normalizeToken)),
    ).filter(Boolean);
    if (uniqMentions.length === 0)
      return { directoryIds: [], missing: [], ambiguous: [] };

    const dirs = await this.repo.listAllForOwner(ownerId);

    const map = new Map<string, Set<string>>();

    // synthetic "unassigned"
    addMap(map, "unassigned", UNASSIGNED_DIRECTORY_ID);
    addMap(map, "inbox", UNASSIGNED_DIRECTORY_ID);
    for (const k of slugVariantsFromName(UNASSIGNED_DIRECTORY_NAME))
      addMap(map, k, UNASSIGNED_DIRECTORY_ID);

    for (const d of dirs) {
      // allow @<directoryId>
      addMap(map, d.id, d.id);

      // allow @<slugifiedName>
      for (const k of slugVariantsFromName(d.name)) addMap(map, k, d.id);
    }

    const directoryIds: string[] = [];
    const missing: string[] = [];
    const ambiguous: string[] = [];

    for (const m of uniqMentions) {
      const set = map.get(m);
      if (!set || set.size === 0) {
        missing.push(m);
        continue;
      }
      if (set.size > 1) {
        ambiguous.push(m);
        continue;
      }
      const [id] = Array.from(set);
      if (id) directoryIds.push(id);
    }

    return {
      directoryIds: Array.from(new Set(directoryIds)),
      missing,
      ambiguous,
    };
  }
}
