import type { RefreshModelsContext } from "@earendil-works/pi-ai";
import type { ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { isClaudeModel } from "./model-api.ts";
import type { MagpieProviderConfig } from "./types.ts";
import type { ProviderModelConfigLike } from "./types.ts";

export interface ProviderRegistration {
  providerName: string;
  config: ProviderConfig;
}

/**
 * The base URL an `anthropic-messages` model must carry.
 *
 * Pi's Anthropic driver builds its endpoint as `<baseUrl>/v1/messages`, while
 * the provider base URL points at magpie's OpenAI-compatible root, which ends
 * in `/v1`. Reusing it verbatim would request `/v1/v1/messages`.
 */
export function anthropicBaseUrl(providerBaseUrl: string): string {
  return providerBaseUrl.replace(/\/+$/u, "").replace(/\/v1$/u, "");
}

export function normalizeProviderModels(
  models: ProviderModelConfigLike[],
  providerBaseUrl?: string,
): ProviderModelConfig[] {
  return models.map((model) => ({
    ...model,
    compat: {
      ...model.compat,
      supportsStrictMode: false,
      ...(isClaudeModel(model.id) && model.api === "anthropic-messages"
        ? { forceAdaptiveThinking: true }
        : {}),
    },
    ...(providerBaseUrl && isClaudeModel(model.id) && model.api === "anthropic-messages"
      ? { baseUrl: anthropicBaseUrl(providerBaseUrl) }
      : {}),
  })) as ProviderModelConfig[];
}

export function buildProviderRegistration(
  config: MagpieProviderConfig,
  models: ProviderModelConfigLike[],
  refreshModels?: (context: RefreshModelsContext) => Promise<ProviderModelConfig[]>,
): ProviderRegistration {
  return {
    providerName: config.providerName,
    config: {
      name: `Magpie (${config.providerName})`,
      baseUrl: config.baseUrl,
      api: "openai-completions",
      apiKey: config.authRequired ? "$PI_MAGPIE_API_KEY" : "magpie",
      authHeader: config.authRequired && config.authHeader,
      headers: Object.keys(config.headers).length > 0 ? config.headers : undefined,
      models: normalizeProviderModels(models, config.baseUrl),
      refreshModels,
    },
  };
}
