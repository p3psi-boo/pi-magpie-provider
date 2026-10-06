import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ProviderCatalog } from "../src/catalog.ts";
import { magpieModelsCachePath } from "../src/discovery.ts";
import { writeCache } from "../src/cache.ts";
import type { MagpieProviderConfig } from "../src/types.ts";

const config: MagpieProviderConfig = {
  providerName: "magpie-catalog-test",
  baseUrl: "http://magpie.test/v1",
  authRequired: false,
  authHeader: false,
  headers: {},
  modelOverrides: {},
};

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), "pi-magpie-catalog-"));
  const originalHome = process.env.HOME;
  process.env.HOME = home;
  try {
    return await fn(home);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(home, { recursive: true, force: true });
  }
}

function catalog(): ProviderCatalog {
  return new ProviderCatalog({
    config,
    getApiKey: async () => undefined,
    backgroundTimeoutMs: 50,
  });
}

test("catalog load ignores malformed source snapshots", async () => {
  await withTempHome(async () => {
    const path = magpieModelsCachePath(config);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ fetchedAt: Date.now(), data: { id: "not-an-array" } }));

    const snapshot = await catalog().load();

    assert.deepEqual(snapshot.magpieModels, []);
    assert.equal(snapshot.built.stats.total, 0);
  });
});

test("catalog load is cache-first and performs no network request", async () => {
  await withTempHome(async () => {
    await writeCache(magpieModelsCachePath(config), [{
      id: "cached",
      name: "cached",
      kind: "chat",
      reasoning: false,
      efforts: [],
      nativeEndpoints: [],
      inputModalities: ["text"],
      knowsImageInput: false,
    }], 1234);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("network should not run"); }) as typeof fetch;
    try {
      const snapshot = await catalog().load();
      assert.deepEqual(snapshot.magpieModels.map((model) => model.id), ["cached"]);
      assert.equal(snapshot.magpieUpdatedAt, 1234);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("background refresh updates magpie models", async () => {
  await withTempHome(async () => {
    await writeCache(magpieModelsCachePath(config), [{
      id: "cached",
      name: "cached",
      kind: "chat",
      reasoning: false,
      efforts: [],
      nativeEndpoints: [],
      inputModalities: ["text"],
      knowsImageInput: false,
    }]);
    const instance = catalog();
    await instance.load();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      assert.equal(String(url), "http://magpie.test/v1/models");
      return new Response(JSON.stringify({
        data: [{
          id: "openai/gpt-6-astra",
          display_name: "GPT-6 Astra",
          native_endpoints: ["/v1/responses"],
          reasoning: true,
          supported_reasoning_levels: [{ effort: "low" }],
        }],
      }), { status: 200 });
    }) as typeof fetch;
    try {
      const result = await instance.refresh("models", "background");
      assert.equal(result.models.updated, true);
      assert.equal(result.models.changed, true);
      assert.deepEqual(result.snapshot.magpieModels.map((model) => model.id), ["openai/gpt-6-astra"]);
      assert.equal(result.snapshot.built.models[0].api, "openai-responses");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("snapshot write failure preserves the in-memory magpie snapshot", async () => {
  await withTempHome(async () => {
    await writeCache(magpieModelsCachePath(config), [{
      id: "cached",
      name: "cached",
      kind: "chat",
      reasoning: false,
      efforts: [],
      nativeEndpoints: [],
      inputModalities: ["text"],
      knowsImageInput: false,
    }]);
    const instance = new ProviderCatalog({
      config,
      getApiKey: async () => undefined,
      writeSnapshot: async () => { throw new Error("disk full"); },
    });
    await instance.load();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [{ id: "fresh" }] }), { status: 200 })) as typeof fetch;
    try {
      const result = await instance.refresh("models", "manual");
      assert.match(String(result.models.error), /disk full/);
      assert.equal(result.models.updated, false);
      assert.deepEqual(result.snapshot.magpieModels.map((model) => model.id), ["cached"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("failed background refresh preserves the last-known-good magpie snapshot", async () => {
  await withTempHome(async () => {
    await writeCache(magpieModelsCachePath(config), [{
      id: "cached",
      name: "cached",
      kind: "chat",
      reasoning: false,
      efforts: [],
      nativeEndpoints: [],
      inputModalities: ["text"],
      knowsImageInput: false,
    }]);
    const instance = catalog();
    await instance.load();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    try {
      const result = await instance.refresh("models", "background");
      assert.match(String(result.models.error), /offline/);
      assert.deepEqual(result.snapshot.magpieModels.map((model) => model.id), ["cached"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("refresh deduplicates concurrent requests", async () => {
  await withTempHome(async () => {
    const instance = catalog();
    await instance.load();
    const originalFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({ data: [{ id: "fresh" }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const keyFn = async () => "runtime-key";
      await Promise.all([
        instance.refresh("models", "background", keyFn, new AbortController().signal),
        instance.refresh("models", "background", keyFn, new AbortController().signal),
      ]);
      assert.equal(fetches, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("deduplicated callers can abort without cancelling the shared refresh", async () => {
  await withTempHome(async () => {
    const instance = catalog();
    await instance.load();
    const originalFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(JSON.stringify({ data: [{ id: "fresh" }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const firstController = new AbortController();
      const secondController = new AbortController();
      const reason = new Error("second caller cancelled");
      const keyFn = async () => "runtime-key";
      const first = instance.refresh("models", "background", keyFn, firstController.signal);
      const second = instance.refresh("models", "background", keyFn, secondController.signal);
      secondController.abort(reason);

      await assert.rejects(second, (error) => error === reason);
      const result = await first;
      assert.equal(result.models.updated, true);
      assert.equal(fetches, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("refresh propagates the initiating caller's cancellation reason", async () => {
  await withTempHome(async () => {
    const instance = catalog();
    await instance.load();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.signal?.aborted) throw init.signal.reason;
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
      throw new Error("unreachable");
    }) as typeof fetch;
    try {
      const controller = new AbortController();
      const reason = new Error("caller cancelled");
      const refresh = instance.refresh("models", "manual", async () => undefined, controller.signal);
      controller.abort(reason);

      await assert.rejects(refresh, (error) => error === reason);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
