import test from "node:test";
import assert from "node:assert/strict";
import type { MagpieModel } from "../src/magpie.ts";
import { buildProviderModels, PI_MODEL_DEFAULTS, thinkingLevelMapFromEfforts } from "../src/provider.ts";

function magpie(partial: Partial<MagpieModel> & Pick<MagpieModel, "id">): MagpieModel {
  return {
    name: partial.name ?? partial.id,
    kind: "chat",
    reasoning: false,
    efforts: [],
    nativeEndpoints: [],
    inputModalities: ["text"],
    knowsImageInput: false,
    ...partial,
  };
}

test("keeps magpie model IDs and maps native endpoints, thinking, window, and vision", () => {
  const result = buildProviderModels([
    magpie({
      id: "openai/gpt-6-astra",
      name: "GPT-6 Astra",
      reasoning: true,
      efforts: ["low", "medium", "high", "xhigh", "max"],
      nativeEndpoints: ["/v1/responses"],
      contextWindow: 272000,
      maxOutputTokens: 128000,
      inputModalities: ["text", "image"],
      knowsImageInput: true,
    }),
    magpie({
      id: "anth/claude-sonnet-5",
      name: "Claude Sonnet 5",
      reasoning: true,
      efforts: ["low", "medium", "high"],
      nativeEndpoints: ["/v1/messages"],
      contextWindow: 200000,
      maxOutputTokens: 64000,
      inputModalities: ["text", "image"],
      knowsImageInput: true,
    }),
    magpie({ id: "group/daily" }),
  ]);

  assert.equal(result.stats.total, 3);
  assert.equal(result.models[0].id, "openai/gpt-6-astra");
  assert.equal(result.models[0].api, "openai-responses");
  assert.equal(result.models[0].reasoning, true);
  assert.deepEqual(result.models[0].input, ["text", "image"]);
  assert.equal(result.models[0].contextWindow, 272000);
  assert.equal(result.models[0].maxTokens, 128000);
  assert.equal(result.models[0].thinkingLevelMap?.low, "low");
  assert.equal(result.models[0].thinkingLevelMap?.off, null);
  assert.equal(result.models[0].promptCache?.short, 300);
  assert.equal(result.models[1].api, "anthropic-messages");
  assert.deepEqual(result.models[1].input, ["text", "image"]);
  assert.equal(result.models[1].thinkingLevelMap?.off, undefined);
  assert.equal(result.models[1].promptCache?.long, 3600);
  assert.equal(result.models[2].api, undefined);
  assert.deepEqual(result.models[2].input, ["text"]);
  assert.equal(result.models[2].contextWindow, PI_MODEL_DEFAULTS.contextWindow);
});

test("skips image and video catalog entries", () => {
  const result = buildProviderModels([
    magpie({ id: "relay/seedream", kind: "image" }),
    magpie({ id: "office/imagine", kind: "video" }),
    magpie({ id: "openai/gpt-5.5" }),
  ]);

  assert.deepEqual(result.models.map((model) => model.id), ["openai/gpt-5.5"]);
  assert.equal(result.stats.skipped, 2);
  assert.deepEqual(result.stats.skippedModelIds, ["relay/seedream", "office/imagine"]);
});

test("treats unknown image input as text-only", () => {
  const result = buildProviderModels([magpie({ id: "relay/mystery" })]);
  assert.deepEqual(result.models[0].input, ["text"]);
});

test("prefers Responses when a model lists both native endpoints", () => {
  const result = buildProviderModels([
    magpie({
      id: "openai/gpt-5.5",
      nativeEndpoints: ["/v1/chat/completions", "/v1/responses"],
    }),
  ]);
  assert.equal(result.models[0].api, "openai-responses");
});

test("builds a Claude thinking map that omits off on Messages", () => {
  const map = thinkingLevelMapFromEfforts(["low", "high", "max"], true);
  assert.equal(map?.off, undefined);
  assert.equal(map?.low, "low");
  assert.equal(map?.minimal, null);
});

test("maps none onto Pi off", () => {
  const map = thinkingLevelMapFromEfforts(["none", "low", "high"], false);
  assert.equal(map?.off, "none");
  assert.equal(map?.low, "low");
});

test("does not share mutable default objects between models", () => {
  const result = buildProviderModels([magpie({ id: "a" }), magpie({ id: "b" })]);
  result.models[0].input.push("image");
  result.models[0].cost.input = 99;
  assert.deepEqual(result.models[1].input, ["text"]);
  assert.equal(result.models[1].cost.input, 0);
});

test("applies bounded user overrides without changing magpie API selection", () => {
  const result = buildProviderModels(
    [magpie({
      id: "openai/gpt-5.6-codex",
      nativeEndpoints: ["/v1/responses"],
      efforts: ["none", "low", "high"],
      reasoning: true,
      contextWindow: 272000,
    })],
    {
      "openai/gpt-5.6-codex": {
        reasoning: false,
        contextWindow: 512000,
        maxTokens: 32768,
      },
    },
  );

  assert.equal(result.models[0].reasoning, false);
  assert.equal(result.models[0].contextWindow, 512000);
  assert.equal(result.models[0].maxTokens, 32768);
  assert.equal(result.models[0].api, "openai-responses");
  assert.equal(result.models[0].thinkingLevelMap?.off, "none");
});
