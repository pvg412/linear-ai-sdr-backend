import { injectable, inject } from "inversify";
import { ADMIN_TYPES } from "../admin.types";
import { ServiceToggleRepository } from "../persistence/service-toggle.repository";
import { UserFacingError } from "@/infra/userFacingError";
import type { ServiceToggleResponse } from "../schemas/service-toggle.schemas";

/**
 * Registry of toggleable external services.
 *
 * Each entry is seeded at startup via `seedDefaults()`. The admin can
 * flip `enabled` at runtime; adapters check the in-memory cache via
 * `isServiceEnabledSync()` — zero DB hits on the hot path.
 */
interface ServiceDefinition {
  serviceKey: string;
  displayName: string;
  description: string | null;
  category: string;
}

const SERVICE_DEFINITIONS: ServiceDefinition[] = [
  {
    serviceKey: "hirebase",
    displayName: "Hiring",
    description: "Detects open positions",
    category: "intelligence",
  },
  {
    serviceKey: "reddit-scraper",
    displayName: "Reddit",
    description: "Monitors discussion subreddit for signals",
    category: "social",
  },
  // ── Future services ──────────────────────────────────────────────
  // {
  //   serviceKey: "twitter-scraper",
  //   displayName: "Social Pulse",
  //   description: "Tracks social media activity and trends",
  //   category: "social",
  // },
];

@injectable()
export class ServiceToggleService {
  /** serviceKey → enabled */
  private cache = new Map<string, boolean>();

  constructor(
    @inject(ADMIN_TYPES.ServiceToggleRepository)
    private readonly repository: ServiceToggleRepository,
  ) {}

  // ── Cache management ────────────────────────────────────────────

  /**
   * Load all toggles into the in-memory cache.
   * Called once at application startup (from the module registration).
   */
  async loadCache(): Promise<void> {
    const toggles = await this.repository.findAll();
    this.cache.clear();
    for (const t of toggles) {
      this.cache.set(t.serviceKey, t.enabled);
    }
  }

  /**
   * Synchronous check — called from adapter `isEnabled()` methods.
   * Returns `true` if the service key is unknown (safe default).
   */
  isServiceEnabledSync(serviceKey: string): boolean {
    return this.cache.get(serviceKey) ?? true;
  }

  // ── Seed ────────────────────────────────────────────────────────

  /**
   * Upsert all known service definitions into the DB.
   * Existing entries keep their `enabled` value (admin override preserved).
   * New entries start with `enabled: true`.
   */
  async seedDefaults(): Promise<void> {
    for (const def of SERVICE_DEFINITIONS) {
      await this.repository.upsertDefault(def);
    }
  }

  // ── Admin API ───────────────────────────────────────────────────

  async getAllToggles(): Promise<ServiceToggleResponse[]> {
    const toggles = await this.repository.findAll();
    return toggles.map((t) => ({
      id: t.id,
      displayName: t.displayName,
      description: t.description,
      category: t.category,
      enabled: t.enabled,
      updatedAt: t.updatedAt,
    }));
  }

  async setEnabled(
    id: string,
    enabled: boolean,
    updatedById: string,
  ): Promise<ServiceToggleResponse> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new UserFacingError({
        code: "NOT_FOUND",
        userMessage: "Service toggle not found",
      });
    }

    const updated = await this.repository.updateEnabled(id, enabled, updatedById);

    // Immediately update in-memory cache
    this.cache.set(updated.serviceKey, updated.enabled);

    return {
      id: updated.id,
      displayName: updated.displayName,
      description: updated.description,
      category: updated.category,
      enabled: updated.enabled,
      updatedAt: updated.updatedAt,
    };
  }
}
