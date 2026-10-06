import test from "node:test";
import assert from "node:assert/strict";
import { anthropicBaseUrl, buildProviderRegistration } from "../src/registration.ts";
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

test("uses environment API key placeholder when auth is required", () => {
  const registration = buildProviderRegistration(config({
    headers: { "User-Agent": "pi" },
  }), [{
    id: "openai/gpt-test",
    name: "GPT Test",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
    compat: { supportsDeveloperRole: true, supportsStrictMode: true },
  }]);

  assert.equal(registration.providerName, "magpie");
  assert.equal(registration.config.apiKey, "$PI_MAGPIE_API_KEY");
  assert.equal(registration.config.authHeader, true);
  assert.deepEqual(registration.config.models?.[0]?.compat, {
    supportsDeveloperRole: true,
    supportsStrictMode: false,
  });
});

test("disables strict mode without changing an explicit Responses API", () => {
  const registration = buildProviderRegistration(config({ authRequired: false, authHeader: false }), [{
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

  assert.deepEqual(registration.config.models?.[0]?.compat, {
    supportsStrictMode: false,
  });
  assert.equal(registration.config.models?.[0]?.api, "openai-responses");
});

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

function registrationForModels(models: ProviderModelConfigLike[]) {
  return buildProviderRegistration(config({ authRequired: false, authHeader: false }), models);
}

test("adds the Anthropic adaptive thinking compat flag to Claude Messages models only", () => {
  const registration = registrationForModels([
    claudeModel("claude-opus-5"),
    claudeModel("0xdev/claude-sonnet-4-6"),
    { ...claudeModel("gemini-3-pro"), api: undefined },
    { ...claudeModel("not-claude-opus"), api: undefined },
  ]);

  const models = registration.config.models ?? [];
  assert.deepEqual(models[0]?.compat, {
    supportsStrictMode: false,
    forceAdaptiveThinking: true,
  });
  assert.deepEqual(models[1]?.compat, {
    supportsStrictMode: false,
    forceAdaptiveThinking: true,
  });
  assert.deepEqual(models[2]?.compat, { supportsStrictMode: false });
  assert.deepEqual(models[3]?.compat, { supportsStrictMode: false });
  assert.equal(models[0]?.api, "anthropic-messages");
  assert.equal((models[0]?.compat as Record<string, unknown>).supportsMidConvoEffort, undefined);
});

test("gives Claude Messages models a base URL without the OpenAI-compatible /v1 suffix", () => {
  const registration = registrationForModels([
    claudeModel("claude-opus-5"),
    { ...claudeModel("gemini-3-pro"), api: undefined },
  ]);

  assert.equal(registration.config.models?.[0]?.baseUrl, "http://127.0.0.1:3425");
  assert.equal(registration.config.models?.[1]?.baseUrl, undefined);
  assert.equal(registration.config.baseUrl, "http://127.0.0.1:3425/v1");
});

test("strips exactly one trailing /v1 when deriving the Anthropic base URL", () => {
  assert.equal(anthropicBaseUrl("http://127.0.0.1:3425/v1"), "http://127.0.0.1:3425");
  assert.equal(anthropicBaseUrl("http://127.0.0.1:3425/v1/"), "http://127.0.0.1:3425");
  assert.equal(anthropicBaseUrl("https://magpie.example.com/proxy/v1"), "https://magpie.example.com/proxy");
  assert.equal(anthropicBaseUrl("https://magpie.example.com/v1/v1"), "https://magpie.example.com/v1");
  assert.equal(anthropicBaseUrl("https://magpie.example.com"), "https://magpie.example.com");
});

test("preserves a pre-existing per-model compat value on Claude models", () => {
  const registration = registrationForModels([
    claudeModel("claude-opus-4-6", { supportsLongCacheRetention: true, supportsStrictMode: true }),
  ]);

  assert.deepEqual(registration.config.models?.[0]?.compat, {
    supportsLongCacheRetention: true,
    supportsStrictMode: false,
    forceAdaptiveThinking: true,
  });
});

test("uses magpie as the dummy key when auth is disabled", () => {
  const registration = buildProviderRegistration(config({ authRequired: false, authHeader: false }), []);
  assert.equal(registration.config.apiKey, "magpie");
  assert.equal(registration.config.authHeader, false);
});

test("forces Authorization header off when auth is disabled", () => {
  const registration = buildProviderRegistration(config({ authRequired: false, authHeader: true }), []);
  assert.equal(registration.config.apiKey, "magpie");
  assert.equal(registration.config.authHeader, false);
});
