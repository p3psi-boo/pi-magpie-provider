import { magpieModelsCachePath, discoveryHeaders } from "./discovery.ts";
import { readCache, writeCache } from "./cache.ts";
import { fetchMagpieModels, parseMagpieModelsCache, type MagpieModel } from "./magpie.ts";
import { buildProviderModels, type BuildProviderModelsResult } from "./provider.ts";
import type { MagpieProviderConfig } from "./types.ts";

export type RefreshTarget = "models" | "all";

export interface CatalogSnapshot {
  magpieModels: MagpieModel[];
  magpieUpdatedAt?: number;
  built: BuildProviderModelsResult;
}

export interface SourceRefreshResult {
  attempted: boolean;
  updated: boolean;
  changed: boolean;
  error?: unknown;
}

export interface CatalogRefreshResult {
  snapshot: CatalogSnapshot;
  models: SourceRefreshResult;
}

export interface ProviderCatalogOptions {
  config: MagpieProviderConfig;
  getApiKey: () => Promise<string | undefined>;
  backgroundTimeoutMs?: number;
  manualTimeoutMs?: number;
  writeSnapshot?: typeof writeCache;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value !== "object") return JSON.stringify(value);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameMagpieModels(left: MagpieModel[], right: MagpieModel[]): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export class ProviderCatalog {
  private snapshot?: CatalogSnapshot;
  private activeRefresh?: Promise<CatalogRefreshResult>;
  private activeRefreshTarget?: RefreshTarget;
  private activeRefreshMode?: "background" | "manual";
  private activeRefreshController?: AbortController;
  private readonly activeRefreshWaiters = new Set<symbol>();
  private readonly options: ProviderCatalogOptions;

  constructor(options: ProviderCatalogOptions) {
    this.options = options;
  }

  async load(): Promise<CatalogSnapshot> {
    const cache = await readCache(magpieModelsCachePath(this.options.config), parseMagpieModelsCache);
    return this.setSnapshot(cache?.data ?? [], cache?.fetchedAt);
  }

  async refresh(
    target: RefreshTarget = "all",
    mode: "background" | "manual" = "manual",
    getDiscoveryApiKey?: () => Promise<string | undefined>,
    signal?: AbortSignal,
  ): Promise<CatalogRefreshResult> {
    if (this.activeRefresh) {
      if (this.activeRefreshTarget === target && this.activeRefreshMode === mode) {
        return this.waitForActiveRefresh(signal);
      }
      await this.activeRefresh;
    }

    const controller = new AbortController();
    this.activeRefreshTarget = target;
    this.activeRefreshMode = mode;
    this.activeRefreshController = controller;
    this.activeRefresh = this.performRefresh(mode, getDiscoveryApiKey, controller.signal).finally(() => {
      this.activeRefresh = undefined;
      this.activeRefreshTarget = undefined;
      this.activeRefreshMode = undefined;
      this.activeRefreshController = undefined;
      this.activeRefreshWaiters.clear();
    });
    return this.waitForActiveRefresh(signal);
  }

  current(): CatalogSnapshot | undefined {
    return this.snapshot;
  }

  private async waitForActiveRefresh(signal?: AbortSignal): Promise<CatalogRefreshResult> {
    const refresh = this.activeRefresh;
    if (!refresh) throw new Error("No active refresh");
    if (signal?.aborted) throw signal.reason ?? new Error("Refresh aborted");

    const waiter = Symbol("refresh-waiter");
    this.activeRefreshWaiters.add(waiter);
    let onAbort: (() => void) | undefined;
    const aborted = signal
      ? new Promise<never>((_resolve, reject) => {
        onAbort = () => {
          this.activeRefreshWaiters.delete(waiter);
          if (this.activeRefreshWaiters.size === 0) {
            this.activeRefreshController?.abort(signal.reason ?? new Error("Refresh aborted"));
          }
          reject(signal.reason ?? new Error("Refresh aborted"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      })
      : undefined;

    try {
      return await (aborted ? Promise.race([refresh, aborted]) : refresh);
    } finally {
      this.activeRefreshWaiters.delete(waiter);
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  private async performRefresh(
    mode: "background" | "manual",
    getDiscoveryApiKey?: () => Promise<string | undefined>,
    signal?: AbortSignal,
  ): Promise<CatalogRefreshResult> {
    const current = this.snapshot ?? await this.load();
    let magpieModels = current.magpieModels;
    let magpieUpdatedAt = current.magpieUpdatedAt;
    const models: SourceRefreshResult = { attempted: true, updated: false, changed: false };

    try {
      const apiKey = await (getDiscoveryApiKey ?? this.options.getApiKey)();
      const fresh = await fetchMagpieModels(
        this.options.config.baseUrl,
        discoveryHeaders(this.options.config, apiKey),
        mode === "background" ? this.options.backgroundTimeoutMs ?? 2_000 : this.options.manualTimeoutMs ?? 10_000,
        signal,
      );
      if (mode === "background" && current.magpieModels.length > 0 && fresh.length === 0) {
        throw new Error("Magpie automatic discovery returned no models; retained the last successful snapshot");
      }
      const freshUpdatedAt = Date.now();
      const changed = !sameMagpieModels(current.magpieModels, fresh);
      await (this.options.writeSnapshot ?? writeCache)(magpieModelsCachePath(this.options.config), fresh, freshUpdatedAt);
      magpieModels = fresh;
      magpieUpdatedAt = freshUpdatedAt;
      models.changed = changed;
      models.updated = true;
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      models.error = error;
    }

    const snapshot = this.setSnapshot(magpieModels, magpieUpdatedAt);
    return { snapshot, models };
  }

  private setSnapshot(magpieModels: MagpieModel[], magpieUpdatedAt: number | undefined): CatalogSnapshot {
    this.snapshot = {
      magpieModels,
      magpieUpdatedAt,
      built: buildProviderModels(magpieModels, this.options.config.modelOverrides),
    };
    return this.snapshot;
  }
}
