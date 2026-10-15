import test from "node:test";
import assert from "node:assert/strict";
import { anthropicBaseUrl, createMagpieProvider, toPiModels } from "../src/registration.ts";
import type { MagpieProviderConfig, ProviderModelConfigLike } from "../src/types.ts";

function config(partial: Partial<MagpieProviderConfig> = {}): MagpieProviderConfig {
  return {
    providerName: "magpie",
    baseUrl: "http://127.0.0.1:3425/v1",
    authRequired: true,
    authHeader: true,
    headers: {},
    modelOverrides: {},
    ...partial,
  };
}

function claudeModel(id: string, compat?: ProviderModelConfigLike["compat"]): ProviderModelConfigLike {
  return {
    id,
    name: id,
    reasoning: true,
    api: "anthropic-messages",
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 64000,
    ...(compat ? { compat } : {}),
  };
}

function catalogWith(models: ProviderModelConfigLike[] = []) {
  return {
    current: () => ({ built: { models, stats: { total: models.length, skipped: 0, skippedModelIds: [] } }, magpieModels: [] }),
    load: async () => ({ built: { models, stats: { total: models.length, skipped: 0, skippedModelIds: [] } }, magpieModels: [] }),
    ingest: async () => {},
    refresh: async () => ({
      snapshot: { built: { models, stats: { total: models.length, skipped: 0, skippedModelIds: [] } }, magpieModels: [] },
      models: { attempted: true, updated: true, changed: true },
    }),
  } as any;
}

test("native provider exposes a custom /login flow instead of a generic API-key prompt", () => {
  const provider = createMagpieProvider({ config: config(), catalog: catalogWith() });
  assert.equal(provider.id, "magpie");
  assert.equal(provider.auth.apiKey?.name, "Magpie gateway");
  assert.equal(typeof provider.auth.apiKey?.login, "function");
  assert.deepEqual(provider.getModels(), []);
});

test("toPiModels disables strict mode without changing an explicit Responses API", () => {
  const models = toPiModels(config(), [{
    id: "openai/gpt-responses-test",
    name: "GPT Responses Test",
    reasoning: true,
    api: "openai-responses",
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
    compat: { supportsStrictMode: true },
  }]);

  assert.equal(models[0]?.api, "openai-responses");
  assert.equal(models[0]?.provider, "magpie");
  assert.deepEqual(models[0]?.compat, { supportsStrictMode: false });
});

test("adds the Anthropic adaptive thinking compat flag to Claude Messages models only", () => {
  const models = toPiModels(config(), [
    claudeModel("claude-opus-5"),
    claudeModel("0xdev/claude-sonnet-4-6"),
    { ...claudeModel("gemini-3-pro"), api: undefined },
    { ...claudeModel("not-claude-opus"), api: undefined },
  ]);

  assert.deepEqual(models[0]?.compat, { supportsStrictMode: false, forceAdaptiveThinking: true });
  assert.deepEqual(models[1]?.compat, { supportsStrictMode: false, forceAdaptiveThinking: true });
  assert.deepEqual(models[2]?.compat, { supportsStrictMode: false });
  assert.deepEqual(models[3]?.compat, { supportsStrictMode: false });
  assert.equal(models[0]?.api, "anthropic-messages");
  assert.equal((models[0]?.compat as Record<string, unknown>).supportsMidConvoEffort, undefined);
});

test("gives Claude Messages models a base URL without the OpenAI-compatible /v1 suffix", () => {
  const models = toPiModels(config(), [
    claudeModel("claude-opus-5"),
    { ...claudeModel("gemini-3-pro"), api: undefined },
  ]);

  assert.equal(models[0]?.baseUrl, "http://127.0.0.1:3425");
  assert.equal(models[1]?.baseUrl, "http://127.0.0.1:3425/v1");
});

test("strips exactly one trailing /v1 when deriving the Anthropic base URL", () => {
  assert.equal(anthropicBaseUrl("http://127.0.0.1:3425/v1"), "http://127.0.0.1:3425");
  assert.equal(anthropicBaseUrl("http://127.0.0.1:3425/v1/"), "http://127.0.0.1:3425");
  assert.equal(anthropicBaseUrl("https://magpie.example.com/proxy/v1"), "https://magpie.example.com/proxy");
  assert.equal(anthropicBaseUrl("https://magpie.example.com/v1/v1"), "https://magpie.example.com/v1");
  assert.equal(anthropicBaseUrl("https://magpie.example.com"), "https://magpie.example.com");
});

test("preserves a pre-existing per-model compat value on Claude models", () => {
  const models = toPiModels(config(), [
    claudeModel("claude-opus-4-6", { supportsLongCacheRetention: true, supportsStrictMode: true }),
  ]);

  assert.deepEqual(models[0]?.compat, {
    supportsLongCacheRetention: true,
    supportsStrictMode: false,
    forceAdaptiveThinking: true,
  });
});
