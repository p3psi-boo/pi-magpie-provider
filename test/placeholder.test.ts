import test from "node:test";
import assert from "node:assert/strict";
import { createMagpieProvider } from "../src/registration.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";

test("registers an empty catalog so /login can see the provider without a fake model", () => {
  const provider = createMagpieProvider({
    config: { ...DEFAULT_CONFIG },
    catalog: {
      current: () => undefined,
      load: async () => ({ magpieModels: [], built: { models: [], stats: { total: 0, skipped: 0, skippedModelIds: [] } } }),
      ingest: async () => ({ magpieModels: [], built: { models: [], stats: { total: 0, skipped: 0, skippedModelIds: [] } } }),
      refresh: async () => ({
        snapshot: { magpieModels: [], built: { models: [], stats: { total: 0, skipped: 0, skippedModelIds: [] } } },
        models: { attempted: true, updated: false, changed: false },
      }),
    } as any,
  });

  assert.deepEqual(provider.getModels(), []);
  assert.equal(typeof provider.auth.apiKey?.login, "function");
});
