import type { ThinkingLevelMap } from "@earendil-works/pi-ai";
import type { MagpieModel } from "./magpie.ts";
import { isClaudeModel, modelApi } from "./model-api.ts";
import type {
  InputModality,
  ProviderModelConfigLike,
  ProviderModelOverrides,
} from "./types.ts";

const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export const PI_MODEL_DEFAULTS = {
  reasoning: false,
  input: ["text"] as InputModality[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 16384,
};

export interface BuildProviderModelsStats {
  total: number;
  skipped: number;
  skippedModelIds: string[];
}

export interface BuildProviderModelsResult {
  models: ProviderModelConfigLike[];
  stats: BuildProviderModelsStats;
}

function cloneModelDefaults(): typeof PI_MODEL_DEFAULTS {
  return {
    ...PI_MODEL_DEFAULTS,
    input: [...PI_MODEL_DEFAULTS.input],
    cost: { ...PI_MODEL_DEFAULTS.cost },
  };
}

function inputFromMagpie(model: MagpieModel): InputModality[] {
  return model.knowsImageInput && model.inputModalities.includes("image")
    ? ["text", "image"]
    : ["text"];
}

/**
 * Map magpie's supported_reasoning_levels onto Pi's thinkingLevelMap.
 * Missing Pi slots are null. Claude on Messages omits `off` so Pi still
 * offers thinking-disabled, matching magpie's models.json writer.
 */
export function thinkingLevelMapFromEfforts(efforts: string[], claudeMessages: boolean): ThinkingLevelMap | undefined {
  if (efforts.length === 0) return undefined;

  const map: Record<string, string | null> = {};
  for (const level of PI_THINKING_LEVELS) map[level] = null;
  for (const effort of efforts) {
    if (effort === "none") map.off = "none";
    else if (levelIsPiThinking(effort)) map[effort] = effort;
  }
  if (claudeMessages && map.off === null) delete map.off;
  return map as ThinkingLevelMap;
}

function levelIsPiThinking(effort: string): effort is typeof PI_THINKING_LEVELS[number] {
  return (PI_THINKING_LEVELS as readonly string[]).includes(effort);
}

function promptCacheFor(model: MagpieModel, api: ProviderModelConfigLike["api"]): ProviderModelConfigLike["promptCache"] {
  const name = model.id.slice(model.id.lastIndexOf("/") + 1).toLowerCase();
  if (api === "anthropic-messages" && name.startsWith("claude")) return { short: 300, long: 3600 };
  if (api === "openai-responses" && name.startsWith("gpt")) return { short: 300 };
  return undefined;
}

function applyModelOverride(
  model: ProviderModelConfigLike,
  overrides: ProviderModelOverrides,
): ProviderModelConfigLike {
  const override = overrides[model.id];
  if (!override) return model;
  return {
    ...model,
    ...(override.reasoning !== undefined ? { reasoning: override.reasoning } : {}),
    ...(override.contextWindow !== undefined ? { contextWindow: override.contextWindow } : {}),
    ...(override.maxTokens !== undefined ? { maxTokens: override.maxTokens } : {}),
  };
}

export function magpieModelToPi(model: MagpieModel, overrides: ProviderModelOverrides = {}): ProviderModelConfigLike {
  const api = modelApi(model);
  const claudeMessages = api === "anthropic-messages" && isClaudeModel(model.id);
  const thinkingLevelMap = thinkingLevelMapFromEfforts(model.efforts, claudeMessages);
  const promptCache = promptCacheFor(model, api);
  return applyModelOverride({
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    ...(api ? { api } : {}),
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    input: inputFromMagpie(model),
    cost: { ...PI_MODEL_DEFAULTS.cost },
    contextWindow: model.contextWindow ?? PI_MODEL_DEFAULTS.contextWindow,
    maxTokens: model.maxOutputTokens ?? PI_MODEL_DEFAULTS.maxTokens,
    ...(promptCache ? { promptCache } : {}),
  }, overrides);
}

export function buildUnavailableProviderModels(id = "login-required"): ProviderModelConfigLike[] {
  return [{ id, name: id, ...cloneModelDefaults() }];
}

export function buildProviderModels(
  magpieModels: MagpieModel[],
  overrides: ProviderModelOverrides = {},
): BuildProviderModelsResult {
  const skippedModelIds: string[] = [];
  const models: ProviderModelConfigLike[] = [];

  for (const magpieModel of magpieModels) {
    if (magpieModel.kind !== "chat") {
      skippedModelIds.push(magpieModel.id);
      continue;
    }
    models.push(magpieModelToPi(magpieModel, overrides));
  }

  return {
    models,
    stats: {
      total: models.length,
      skipped: skippedModelIds.length,
      skippedModelIds,
    },
  };
}
