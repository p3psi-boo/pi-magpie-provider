import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "../extensions/index.ts";

async function withTempCwd<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), "pi-magpie-extension-"));
  const originalCwd = process.cwd();
  try {
    process.chdir(cwd);
    return await fn(cwd);
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

function captureProvider(register: (provider: any) => void) {
  return (providerOrName: any, maybeConfig?: any) => {
    if (typeof providerOrName === "string") {
      register({ id: providerOrName, ...maybeConfig, getModels: () => maybeConfig?.models ?? [] });
      return;
    }
    register(providerOrName);
  };
}

test("extension registers a native provider with login and refreshModels", async () => {
  const home = await mkdtemp(join(tmpdir(), "pi-magpie-extension-lifecycle-home-"));
  const originalHome = process.env.HOME;
  const originalFetch = globalThis.fetch;

  try {
    process.env.HOME = home;
    globalThis.fetch = (async (url: string | URL | Request) => {
      assert.equal(String(url), "http://127.0.0.1:3425/v1/models");
      return new Response(JSON.stringify({
        data: [{
          id: "fresh-model",
          native_endpoints: ["/v1/responses"],
          context_window: 272000,
        }],
      }), { status: 200 });
    }) as typeof fetch;

    await withTempCwd(async () => {
      const providers: any[] = [];
      await extension({
        registerCommand: () => {},
        registerProvider: captureProvider((provider) => providers.push(provider)),
        on: () => {},
      } as any);

      assert.equal(providers[0].id, "magpie");
      assert.equal(typeof providers[0].auth.apiKey.login, "function");
      assert.equal(typeof providers[0].refreshModels, "function");
      assert.deepEqual(providers[0].getModels(), []);

      await providers[0].refreshModels({
        allowNetwork: true,
        signal: new AbortController().signal,
        credential: { type: "api_key", key: "test-key" },
        publish: async () => true,
      });
      assert.equal(providers[0].getModels()[0].id, "fresh-model");
      assert.equal(providers[0].getModels()[0].api, "openai-responses");
      assert.equal(providers[0].getModels()[0].contextWindow, 272000);
      assert.equal(providers[0].getModels()[0].compat?.supportsStrictMode, false);
      assert.equal(providers.length, 1);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("manual refresh uses the active model registry credential", async () => {
  const home = await mkdtemp(join(tmpdir(), "pi-magpie-extension-refresh-home-"));
  const originalHome = process.env.HOME;
  const originalFetch = globalThis.fetch;

  try {
    process.env.HOME = home;
    await withTempCwd(async (cwd) => {
      let commandHandler: ((args: string, ctx: any) => Promise<void>) | undefined;
      let receivedAuthorization: string | null = null;
      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        receivedAuthorization = headers.get("Authorization");
        if (receivedAuthorization !== "Bearer runtime-key") {
          return new Response("unauthorized", { status: 401, statusText: "Unauthorized" });
        }
        return new Response(JSON.stringify({ data: [{ id: "fresh-model" }] }), { status: 200 });
      }) as typeof fetch;

      await extension({
        registerCommand: (_name: string, options: any) => { commandHandler = options.handler; },
        registerProvider: () => {},
        on: () => {},
      } as any);

      const notifications: Array<{ message: string; level: string }> = [];
      await commandHandler?.("refresh", {
        cwd,
        modelRegistry: {
          getApiKeyForProvider: async (providerName: string) => {
            assert.equal(providerName, "magpie");
            return "runtime-key";
          },
        },
        ui: {
          notify: (message: string, level: string) => notifications.push({ message, level }),
        },
      });

      assert.equal(receivedAuthorization, "Bearer runtime-key");
      assert.equal(notifications.at(-1)?.level, "info");
      assert.doesNotMatch(notifications.at(-1)?.message ?? "", /401 Unauthorized/);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("extension registers a login-capable provider when global config is invalid", async () => {
  const home = await mkdtemp(join(tmpdir(), "pi-magpie-extension-home-"));
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = home;
    await withTempCwd(async () => {
      const configDir = join(home, ".pi", "agent", "pi-magpie-provider");
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, "config.json"), JSON.stringify({ headers: null }));

      const providers: any[] = [];
      await extension({
        registerCommand: () => {},
        registerProvider: captureProvider((provider) => providers.push(provider)),
        on: () => {},
      } as any);

      assert.equal(providers.length, 1);
      assert.equal(providers[0].id, "magpie");
      assert.equal(typeof providers[0].auth.apiKey.login, "function");
      assert.deepEqual(providers[0].getModels(), []);
    });
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("discovery failures notify the session UI before and after startup, while success stays silent", async () => {
  const home = await mkdtemp(join(tmpdir(), "pi-magpie-extension-warning-home-"));
  const originalHome = process.env.HOME;
  const originalFetch = globalThis.fetch;
  try {
    process.env.HOME = home;
    let fail = true;
    globalThis.fetch = (async () => {
      if (fail) {
        throw new TypeError("fetch failed", {
          cause: Object.assign(new Error("connection reset by peer"), { code: "ECONNRESET" }),
        });
      }
      return new Response(JSON.stringify({ data: [{ id: "fresh-model" }] }), { status: 200 });
    }) as typeof fetch;
    await withTempCwd(async () => {
      let provider: any;
      let sessionStart: any;
      const notifications: Array<{ message: string; level: string }> = [];
      await extension({
        registerCommand: () => {},
        registerProvider: captureProvider((registered) => { provider = registered; }),
        on: (event: string, handler: any) => {
          if (event === "session_start") sessionStart = handler;
        },
      } as any);
      const refresh = () => provider.refreshModels({
        allowNetwork: true,
        signal: new AbortController().signal,
        credential: { type: "api_key", key: "test-key" },
        publish: async () => true,
      });
      await refresh();
      assert.deepEqual(provider.getModels(), []);
      assert.equal(notifications.length, 0);
      await sessionStart({}, {
        ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
      });
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].level, "warning");
      assert.match(notifications[0].message, /http:\/\/127\.0\.0\.1:3425\/v1\/models/);
      assert.match(notifications[0].message, /connection reset by peer \(ECONNRESET\)/);
      assert.match(notifications[0].message, /\/login magpie/);
      assert.doesNotMatch(notifications[0].message, /test-key/);
      await sessionStart({}, {
        ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
      });
      assert.equal(notifications.length, 1, "queued warning is consumed once");
      await refresh();
      assert.equal(notifications.length, 2, "subsequent failures notify immediately");
      fail = false;
      await refresh();
      assert.equal(provider.getModels()[0].id, "fresh-model");
      assert.equal(notifications.length, 2, "successful discovery does not warn");
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(home, { recursive: true, force: true });
  }
});
