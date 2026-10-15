import type { Api, Model, Provider, RefreshModelsContext } from "@earendil-works/pi-ai";
import { stream, streamSimple } from "@earendil-works/pi-ai/compat";
import { createMagpieApiKeyAuth, credentialBaseUrl, getDiscoveryApiKey } from "./auth.ts";
import type { ProviderCatalog } from "./catalog.ts";
import { isClaudeModel } from "./model-api.ts";
import { modelsEndpoint } from "./magpie.ts";
import type { MagpieProviderConfig, ProviderModelConfigLike } from "./types.ts";

export interface MagpieProviderOptions {
  config: MagpieProviderConfig;
  catalog: ProviderCatalog;
  onDiscoveryError?: (message: string) => void;
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

function modelApi(model: ProviderModelConfigLike): Api {
  return model.api ?? "openai-completions";
}

export function toPiModels(
  config: MagpieProviderConfig,
  models: ProviderModelConfigLike[],
  baseUrl = config.baseUrl,
): Model<Api>[] {
  return models.map((model) => {
    const api = modelApi(model);
    const claudeMessages = isClaudeModel(model.id) && api === "anthropic-messages";
    return {
      ...model,
      api,
      provider: config.providerName,
      baseUrl: claudeMessages ? anthropicBaseUrl(baseUrl) : baseUrl,
      compat: {
        ...model.compat,
        supportsStrictMode: false,
        ...(claudeMessages ? { forceAdaptiveThinking: true } : {}),
      },
    } as Model<Api>;
  });
}

function applyCredentialUrl(config: MagpieProviderConfig, context: RefreshModelsContext): string {
  const fromCredential = credentialBaseUrl(context.credential);
  if (fromCredential) {
    config.baseUrl = fromCredential;
    return fromCredential;
  }
  return config.baseUrl;
}

function discoveryErrorMessage(config: MagpieProviderConfig, error: unknown, retained: boolean): string {
  const details = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error.cause : undefined;
  const causeDetails = cause instanceof Error
    ? `${cause.message}${"code" in cause ? ` (${String(cause.code)})` : ""}`
    : cause === undefined ? "" : String(cause);
  const fallback = retained
    ? "Retained the last successful model snapshot."
    : "No model snapshot is available yet. Run /login magpie if this gateway needs a key.";
  return [
    `Magpie model discovery failed: ${modelsEndpoint(config.baseUrl)}`,
    `${details}${causeDetails ? `: ${causeDetails}` : ""}`,
    fallback,
    "Check the gateway connection, then retry with /login magpie or /magpie refresh.",
  ].join("\n");
}

export function createMagpieProvider(options: MagpieProviderOptions): Provider {
  const { config, catalog, onDiscoveryError } = options;

  const modelsFromCatalog = (): Model<Api>[] => {
    const snapshot = catalog.current();
    if (!snapshot) return [];
    return toPiModels(config, snapshot.built.models);
  };

  return {
    id: config.providerName,
    name: `Magpie (${config.providerName})`,
    baseUrl: config.baseUrl,
    headers: Object.keys(config.headers).length > 0 ? config.headers : undefined,
    auth: {
      apiKey: createMagpieApiKeyAuth(config, async (models) => {
        await catalog.ingest(models);
      }),
    },
    getModels: modelsFromCatalog,
    refreshModels: async (context) => {
      const baseUrl = applyCredentialUrl(config, context);
      if (!context.allowNetwork) {
        await catalog.load();
        await context.publish({ update: () => undefined });
        return;
      }

      const credential = context.credential;
      const keyFn: () => Promise<string | undefined> = credential?.type === "api_key"
        ? async () => credential.key
        : () => getDiscoveryApiKey(config.providerName);
      const mode = context.force ? "manual" : "background";
      const result = await catalog.refresh("models", mode, keyFn, context.signal);
      if (result.models.error) {
        onDiscoveryError?.(discoveryErrorMessage(config, result.models.error, result.snapshot.built.models.length > 0));
      }

      const models = toPiModels(config, result.snapshot.built.models, baseUrl);
      await context.publish({
        persist: { models, checkedAt: Date.now() },
        update: () => undefined,
      });
    },
    stream: (model, context, options) => stream(model, context, options as never),
    streamSimple: (model, context, options) => streamSimple(model, context, options as never),
  };
}

export function fingerprintModels(models: Model<Api>[]): string {
  return JSON.stringify(models.map((model) => ({
    id: model.id,
    api: model.api,
    baseUrl: model.baseUrl,
    reasoning: model.reasoning,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  })));
}
