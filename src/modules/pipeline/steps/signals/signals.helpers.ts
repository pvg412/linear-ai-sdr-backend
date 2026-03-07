/* ------------------------------------------------------------------ */
/*  Shared types & pure helpers for signal processors                   */
/* ------------------------------------------------------------------ */

/** Keyed by normalised company name (lowercased trim). */
export type CompanyGroup = {
  /** Original company name string as stored on the lead. */
  companyName: string;
  companyDomain: string | null | undefined;
  leadIds: string[];
};

export type RunLead = {
  lead: {
    id: string;
    fullName: string | null;
    company: string | null;
    companyDomain: string | null;
  };
};

export type LeadInfo = {
  id: string;
  fullName: string | null;
  company: string | null;
  companyDomain: string | null;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Groups leads by normalised company name so that all leads at the
 * same company share a single provider API call.
 */
export function buildCompanyGroups(runLeads: RunLead[]): Map<string, CompanyGroup> {
  const groups = new Map<string, CompanyGroup>();

  for (const rl of runLeads) {
    const rawName = rl.lead.company;
    if (!rawName) continue;

    const key = rawName.trim().toLowerCase();

    const existing = groups.get(key);
    if (existing) {
      existing.leadIds.push(rl.lead.id);
    } else {
      groups.set(key, {
        companyName: rawName.trim(),
        companyDomain: rl.lead.companyDomain,
        leadIds: [rl.lead.id],
      });
    }
  }

  return groups;
}

export function pluralise(singular: string, plural: string, count: number): string {
  return count === 1 ? singular : plural;
}

/**
 * Executes `fn` for every item in `items`, running at most `concurrency`
 * invocations in parallel (worker-pool pattern).
 */
export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from(
    { length: Math.min(concurrency, queue.length) },
    async () => {
      while (queue.length > 0) {
        const item = queue.shift()!;
        await fn(item);
      }
    },
  );
  await Promise.all(workers);
}

/**
 * Splits an array into chunks of the specified size.
 */
export function createBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}
