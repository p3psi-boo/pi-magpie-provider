import test from "node:test";
import assert from "node:assert/strict";
import { parseMagpieModelsResponse, modelsEndpoint, fetchMagpieModels } from "../src/magpie.ts";

test("builds the OpenAI-compatible models endpoint from a /v1 base URL", () => {
  assert.equal(modelsEndpoint("http://127.0.0.1:3425/v1"), "http://127.0.0.1:3425/v1/models");
  assert.equal(modelsEndpoint("http://127.0.0.1:3425/v1/"), "http://127.0.0.1:3425/v1/models");
});

test("parses magpie /v1/models fields used to register Pi models", () => {
  const models = parseMagpieModelsResponse({
    object: "list",
    data: [
      {
        id: "openai/gpt-6-astra",
        display_name: "GPT-6 Astra",
        owned_by: "openai",
        reasoning: true,
        supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
        native_endpoints: ["/v1/responses"],
        context_window: 272000,
        max_output_tokens: 128000,
        modalities: { input: ["text", "image"] },
      },
      { object: "model", owned_by: "broken" },
      {
        id: "anth/claude-sonnet-5",
        display_name: "Claude Sonnet 5",
        native_endpoints: ["/v1/messages"],
        modalities: { input: ["text"] },
      },
      { id: "relay/flux", kind: "image", modalities: { input: ["text"], output: ["image"] } },
    ],
  });

  assert.deepEqual(models.map((model) => model.id), [
    "anth/claude-sonnet-5",
    "openai/gpt-6-astra",
    "relay/flux",
  ]);
  const astra = models.find((model) => model.id === "openai/gpt-6-astra");
  assert.equal(astra?.name, "GPT-6 Astra");
  assert.equal(astra?.reasoning, true);
  assert.deepEqual(astra?.efforts, ["low", "high"]);
  assert.deepEqual(astra?.nativeEndpoints, ["/v1/responses"]);
  assert.equal(astra?.contextWindow, 272000);
  assert.equal(astra?.maxOutputTokens, 128000);
  assert.equal(astra?.knowsImageInput, true);
  assert.deepEqual(astra?.inputModalities, ["text", "image"]);
  assert.equal(astra?.kind, "chat");
  const flux = models.find((model) => model.id === "relay/flux");
  assert.equal(flux?.kind, "image");
  const claude = models.find((model) => model.id === "anth/claude-sonnet-5");
  assert.equal(claude?.knowsImageInput, true);
  assert.deepEqual(claude?.inputModalities, ["text"]);
});

test("treats omitted modalities as unknown image input", () => {
  const [model] = parseMagpieModelsResponse({
    data: [{ id: "group/daily" }],
  });
  assert.equal(model.knowsImageInput, false);
  assert.deepEqual(model.inputModalities, ["text"]);
  assert.equal(model.kind, "chat");
});

test("aborts magpie model discovery instead of waiting forever on a stuck network fetch", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  })) as typeof fetch;

  try {
    await assert.rejects(
      () => fetchMagpieModels("http://127.0.0.1:3425/v1", {}, 1),
      /timed out after 1ms/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
