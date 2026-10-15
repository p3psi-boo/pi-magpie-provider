import test from "node:test";
import assert from "node:assert/strict";
import { ProviderRuntime } from "../src/runtime.ts";
import type { MagpieProviderConfig } from "../src/types.ts";

const config: MagpieProviderConfig = {
  providerName: "magpie",
  baseUrl: "http://127.0.0.1:3425/v1",
  authRequired: false,
  authHeader: false,
  headers: {},
  modelOverrides: {},
};

function refreshContext(overrides: Record<string, unknown> = {}): any {
  return {
    allowNetwork: true,
    signal: new AbortController().signal,
    publish: async () => true,
    ...overrides,
  };
}

function snapshot(id: string, reasoning = false): any {
  const model = { id, name: id, reasoning, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384 };
  return {
    magpieModels: id ? [{ id }] : [],
    built: { models: id ? [model] : [], stats: { total: id ? 1 : 0, skipped: 0, skippedModelIds: [] } },
  };
}

function catalogState(initial: any) {
  let current = initial;
  return {
    current: () => current,
    load: async () => current,
    ingest: async () => current,
    refresh: async () => ({
      snapshot: current,
      models: { attempted: true, updated: true, changed: true },
    }),
    set(next: any) { current = next; },
  };
}

test("runtime registers cached models immediately and refreshes without reload", async () => {
  const registrations: any[] = [];
  const catalog = catalogState(snapshot("cached"));
  const runtime = new ProviderRuntime({
    pi: { registerProvider: (provider: any) => registrations.push(provider) } as any,
    config,
    catalog: catalog as any,
  });

  await runtime.start();
  assert.equal(registrations.length, 1);
  assert.equal(runtime.provider.getModels()[0].id, "cached");
  assert.equal(runtime.provider.getModels()[0].compat.supportsStrictMode, false);

  catalog.set(snapshot("fresh", true));
  await runtime.refresh("models", "background");

  assert.equal(registrations.length, 2);
  assert.equal(runtime.provider.getModels()[0].id, "fresh");
  assert.equal(runtime.provider.getModels()[0].reasoning, true);
});

test("runtime refreshModels invokes a models-only catalog refresh with network when allowNetwork is true", async () => {
  let current = snapshot("cached");
  const catalog = {
    current: () => current,
    load: async () => current,
    ingest: async () => current,
    refresh: async (target: string, mode: string, _getApiKey: any, signal?: AbortSignal) => {
      assert.equal(target, "models");
      assert.equal(mode, "background");
      if (signal?.aborted) throw signal.reason;
      const refreshed = snapshot("network-fresh");
      refreshed.built.models[0].api = "openai-responses";
      refreshed.built.models[0].compat = { supportsStrictMode: true };
      current = refreshed;
      return {
        snapshot: refreshed,
        models: { attempted: true, updated: true, changed: true },
      };
    },
  };
  const runtime = new ProviderRuntime({
    pi: { registerProvider: () => {} } as any,
    config,
    catalog: catalog as any,
  });

  await runtime.provider.refreshModels!(refreshContext({ allowNetwork: false }));
  assert.equal(runtime.provider.getModels()[0].id, "cached");
  assert.equal((runtime.provider.getModels()[0].compat as { supportsStrictMode?: boolean })?.supportsStrictMode, false);

  await runtime.provider.refreshModels!(refreshContext());
  assert.equal(runtime.provider.getModels()[0].id, "network-fresh");
  assert.equal(runtime.provider.getModels()[0].api, "openai-responses");
  assert.equal((runtime.provider.getModels()[0].compat as { supportsStrictMode?: boolean })?.supportsStrictMode, false);
});

test("runtime refreshModels lets Pi publish the returned catalog without competing registration", async () => {
  let registrations = 0;
  const catalog = {
    current: () => snapshot("gpt-5.6-codex", true),
    load: async () => snapshot("cached"),
    ingest: async () => snapshot("cached"),
    refresh: async () => ({
      snapshot: snapshot("gpt-5.6-codex", true),
      models: { attempted: true, updated: true, changed: true },
    }),
  };
  const runtime = new ProviderRuntime({
    pi: { registerProvider: () => { registrations += 1; } } as any,
    config,
    catalog: catalog as any,
  });

  await runtime.provider.refreshModels!(refreshContext());
  assert.equal(registrations, 0);
  assert.equal(runtime.provider.getModels()[0].id, "gpt-5.6-codex");
});

test("runtime refreshModels publishes an empty catalog after an empty network refresh", async () => {
  const empty = snapshot("");
  const catalog = {
    current: () => empty,
    load: async () => snapshot("cached"),
    ingest: async () => empty,
    refresh: async () => ({
      snapshot: empty,
      models: { attempted: true, updated: true, changed: true },
    }),
  };
  const runtime = new ProviderRuntime({
    pi: { registerProvider: () => {} } as any,
    config,
    catalog: catalog as any,
  });

  let persisted: any;
  await runtime.provider.refreshModels!(refreshContext({
    publish: async (publication: any) => {
      persisted = publication.persist;
      return true;
    },
  }));

  assert.deepEqual(persisted.models, []);
  assert.equal(runtime.provider.getModels().length, 0);
});

test("runtime refreshModels maps context.force to manual mode and passes signal", async () => {
  let receivedMode: string | undefined;
  let receivedSignal: AbortSignal | undefined;
  const catalog = {
    current: () => snapshot("manual-fresh"),
    load: async () => snapshot("cached"),
    ingest: async () => snapshot("cached"),
    refresh: async (_target: string, mode: string, _getApiKey: any, signal?: AbortSignal) => {
      receivedMode = mode;
      receivedSignal = signal;
      return {
        snapshot: snapshot("manual-fresh"),
        models: { attempted: true, updated: true, changed: true },
      };
    },
  };
  const runtime = new ProviderRuntime({
    pi: { registerProvider: () => {} } as any,
    config,
    catalog: catalog as any,
  });

  const controller = new AbortController();
  await runtime.provider.refreshModels!(refreshContext({ force: true, signal: controller.signal }));

  assert.equal(receivedMode, "manual");
  assert.equal(receivedSignal, controller.signal);
});

test("runtime refreshModels uses Pi's effective API-key credential", async () => {
  let receivedApiKey: string | undefined;
  const catalog = {
    current: () => snapshot("credential-fresh"),
    load: async () => snapshot("cached"),
    ingest: async () => snapshot("cached"),
    refresh: async (_target: string, _mode: string, getApiKey: () => Promise<string | undefined>) => {
      receivedApiKey = await getApiKey();
      return {
        snapshot: snapshot("credential-fresh"),
        models: { attempted: true, updated: true, changed: true },
      };
    },
  };
  const runtime = new ProviderRuntime({
    pi: { registerProvider: () => {} } as any,
    config,
    catalog: catalog as any,
  });

  await runtime.provider.refreshModels!(refreshContext({
    credential: { type: "api_key", key: "runtime-key" },
  }));

  assert.equal(receivedApiKey, "runtime-key");
});

test("runtime refreshModels leaves publication to Pi", async () => {
  const registrations: any[] = [];
  const catalog = catalogState(snapshot("cached"));
  const runtime = new ProviderRuntime({
    pi: { registerProvider: (provider: any) => registrations.push(provider) } as any,
    config,
    catalog: catalog as any,
  });

  await runtime.start();
  catalog.set(snapshot("fresh"));
  await runtime.provider.refreshModels!(refreshContext());

  assert.equal(runtime.provider.getModels()[0].id, "fresh");
  assert.equal(registrations.length, 1);
});

test("failed discovery warns and retains cached models", async () => {
  const warnings: string[] = [];
  const cached = snapshot("cached");
  const runtime = new ProviderRuntime({
    pi: { registerProvider: () => {} } as any,
    config,
    catalog: {
      current: () => cached,
      load: async () => cached,
      ingest: async () => cached,
      refresh: async () => ({
        snapshot: cached,
        models: { attempted: true, updated: false, changed: false, error: new Error("HTTP 503 Service Unavailable") },
      }),
    } as any,
    onDiscoveryError: (message) => warnings.push(message),
  });
  await runtime.provider.refreshModels!(refreshContext({ force: true }));
  assert.equal(runtime.provider.getModels()[0].id, "cached");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /HTTP 503 Service Unavailable/);
  assert.match(warnings[0], /Retained the last successful model snapshot/);
});

test("caller cancellation propagates without a discovery warning", async () => {
  const warnings: string[] = [];
  const controller = new AbortController();
  const reason = new Error("caller cancelled");
  controller.abort(reason);
  const runtime = new ProviderRuntime({
    pi: { registerProvider: () => {} } as any,
    config,
    catalog: {
      current: () => snapshot("cached"),
      load: async () => snapshot("cached"),
      ingest: async () => snapshot("cached"),
      refresh: async () => { throw reason; },
    } as any,
    onDiscoveryError: (message) => warnings.push(message),
  });
  await assert.rejects(runtime.provider.refreshModels!(refreshContext({ signal: controller.signal })), (error) => error === reason);
  assert.equal(warnings.length, 0);
});
