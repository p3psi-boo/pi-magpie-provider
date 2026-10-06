import { join } from "node:path";
import { cacheDir, providerCacheKey } from "./config.ts";
import type { MagpieProviderConfig } from "./types.ts";

export function magpieModelsCachePath(config: MagpieProviderConfig): string {
  return join(cacheDir(), providerCacheKey(config), "magpie-models.json");
}

export function discoveryHeaders(config: MagpieProviderConfig, apiKey?: string): Record<string, string> {
  return {
    ...config.headers,
    ...(config.authHeader && apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}
