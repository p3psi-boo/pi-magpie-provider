import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAGPIE_API_KEY_ENV,
  MAGPIE_BASE_URL_ENV,
  createMagpieApiKeyAuth,
  credentialBaseUrl,
  resolveGatewayUrl,
} from "../src/auth.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { MagpieModel } from "../src/magpie.ts";
import type { MagpieProviderConfig } from "../src/types.ts";

function config(partial: Partial<MagpieProviderConfig> = {}): MagpieProviderConfig {
  return { ...DEFAULT_CONFIG, headers: {}, modelOverrides: {}, ...partial };
}

function interaction(answers: string[]) {
  const prompts: string[] = [];
  const events: Array<{ type: string; message?: string }> = [];
  return {
    prompts,
    events,
    signal: new AbortController().signal,
    prompt: async (prompt: { message: string }) => {
      prompts.push(prompt.message);
      return answers.shift() ?? "";
    },
    notify: (event: { type: string; message?: string }) => events.push(event),
  };
}

test("credentialBaseUrl reads the stored gateway URL", () => {
  assert.equal(credentialBaseUrl({ type: "api_key", env: { [MAGPIE_BASE_URL_ENV]: "http://gw.test/v1" } }), "http://gw.test/v1");
  assert.equal(credentialBaseUrl({ type: "api_key", key: "secret" }), undefined);
  assert.equal(credentialBaseUrl({ type: "oauth", access: "a", refresh: "r", expires: 1 }), undefined);
});

test("resolveGatewayUrl prefers credential env over config", async () => {
  const resolved = await resolveGatewayUrl(
    config({ baseUrl: "http://config.test/v1" }),
    { env: async () => "http://env.test/v1" },
    { type: "api_key", env: { [MAGPIE_BASE_URL_ENV]: "http://cred.test" } },
  );
  assert.equal(resolved, "http://cred.test/v1");
});

test("login collects URL and key, validates the catalog, and stores both", async () => {
  const home = await mkdtemp(join(tmpdir(), "pi-magpie-login-"));
  const originalHome = process.env.HOME;
  const originalFetch = globalThis.fetch;
  const ingested: MagpieModel[][] = [];
  const cfg = config({ authRequired: true, authHeader: true });

  try {
    process.env.HOME = home;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(url), "http://magpie.example:3425/v1/models");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer gw-key");
      return new Response(JSON.stringify({ data: [{ id: "openai/gpt-test" }] }), { status: 200 });
    }) as typeof fetch;

    const auth = createMagpieApiKeyAuth(cfg, async (models) => { ingested.push(models); });
    const ui = interaction(["http://magpie.example:3425", "gw-key"]);
    const credential = await auth.login!(ui as any);

    assert.deepEqual(ui.prompts, [
      "Magpie gateway URL",
      "Gateway API key (optional if the gateway allows unauthenticated access)",
    ]);
    assert.equal(credential.type, "api_key");
    assert.equal(credential.key, "gw-key");
    assert.equal(credential.env?.[MAGPIE_BASE_URL_ENV], "http://magpie.example:3425/v1");
    assert.equal(ingested[0]?.[0]?.id, "openai/gpt-test");
    assert.equal(cfg.baseUrl, "http://magpie.example:3425/v1");
    const saved = JSON.parse(await readFile(join(home, ".pi", "agent", "pi-magpie-provider", "config.json"), "utf8"));
    assert.equal(saved.baseUrl, "http://magpie.example:3425/v1");
    assert.equal(saved.authRequired, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("login allows an empty key for unauthenticated gateways", async () => {
  const home = await mkdtemp(join(tmpdir(), "pi-magpie-login-optional-"));
  const originalHome = process.env.HOME;
  const originalFetch = globalThis.fetch;
  const cfg = config({ authRequired: true, authHeader: true });
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("Authorization"), null);
    return new Response(JSON.stringify({ data: [{ id: "local/model" }] }), { status: 200 });
  }) as typeof fetch;
  try {
    process.env.HOME = home;
    const auth = createMagpieApiKeyAuth(cfg, async () => {});
    const credential = await auth.login!(interaction(["", ""]) as any);
    assert.equal(credential.key, undefined);
    assert.equal(credential.env?.[MAGPIE_BASE_URL_ENV], DEFAULT_CONFIG.baseUrl);
    assert.equal(cfg.authRequired, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("resolve requires a key when auth is required", async () => {
  const auth = createMagpieApiKeyAuth(config({ authRequired: true }), async () => {});
  const resolved = await auth.resolve({
    ctx: { env: async () => undefined, fileExists: async () => false },
    signal: new AbortController().signal,
  });
  assert.equal(resolved, undefined);
});

test("resolve uses a stored key and gateway URL", async () => {
  const auth = createMagpieApiKeyAuth(config({ authRequired: true, authHeader: true }), async () => {});
  const resolved = await auth.resolve({
    ctx: { env: async () => undefined, fileExists: async () => false },
    credential: { type: "api_key", key: "stored", env: { [MAGPIE_BASE_URL_ENV]: "http://stored.test/v1" } },
    signal: new AbortController().signal,
  });
  assert.equal(resolved?.auth.apiKey, "stored");
  assert.equal(resolved?.auth.baseUrl, "http://stored.test/v1");
  assert.equal(resolved?.auth.headers?.Authorization, "Bearer stored");
  assert.equal(resolved?.source, "stored credential");
});

test("resolve falls back to the environment API key", async () => {
  const auth = createMagpieApiKeyAuth(config({ authRequired: true, authHeader: true }), async () => {});
  const resolved = await auth.resolve({
    ctx: {
      env: async (name: string) => name === MAGPIE_API_KEY_ENV ? "env-key" : undefined,
      fileExists: async () => false,
    },
    signal: new AbortController().signal,
  });
  assert.equal(resolved?.auth.apiKey, "env-key");
  assert.equal(resolved?.source, MAGPIE_API_KEY_ENV);
});
