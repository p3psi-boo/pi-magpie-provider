import type { RefreshModelsContext } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { getDiscoveryApiKey } from "./auth.ts";
import { ProviderCatalog, type CatalogRefreshResult, type CatalogSnapshot, type RefreshTarget } from "./catalog.ts";
import { buildUnavailableProviderModels } from "./provider.ts";
import { buildProviderRegistration, normalizeProviderModels } from "./registration.ts";
import type { MagpieProviderConfig } from "./types.ts";
import { modelsEndpoint } from "./magpie.ts";

export interface ProviderRuntimeOptions {
  pi: ExtensionAPI;
  config: MagpieProviderConfig;
  catalog: ProviderCatalog;
  onDiscoveryError?: (message: string) => void;
}

export class ProviderRuntime {
  private registeredFingerprint?: string;
  private readonly options: ProviderRuntimeOptions;

  constructor(options: ProviderRuntimeOptions) {
    this.options = options;
  }

  async start(): Promise<CatalogSnapshot> {
    const snapshot = await this.options.catalog.load();
    this.register(snapshot, true);
    return snapshot;
  }

  async refresh(
    target: RefreshTarget = "all",
    mode: "background" | "manual" = "manual",
    getDiscoveryApiKey?: () => Promise<string | undefined>,
  ): Promise<CatalogRefreshResult> {
    const result = await this.options.catalog.refresh(target, mode, getDiscoveryApiKey);
    if (result.models.updated) this.register(result.snapshot, false);
    return result;
  }

  async refreshModels(context: RefreshModelsContext): Promise<ProviderModelConfig[]> {
    if (!context.allowNetwork) {
      const snapshot = await this.options.catalog.load();
      return normalizeProviderModels(
        snapshot.built.models.length > 0 ? snapshot.built.models : buildUnavailableProviderModels(),
        this.options.config.baseUrl,
      );
    }
    const mode = context.force ? "manual" : "background";
    const credential = context.credential;
    const keyFn: () => Promise<string | undefined> = credential?.type === "api_key"
      ? async () => credential.key
      : () => getDiscoveryApiKey(this.options.config.providerName);
    const result = await this.options.catalog.refresh("models", mode, keyFn, context.signal);
    if (result.models.error) {
      const error = result.models.error;
      const details = error instanceof Error ? error.message : String(error);
      const cause = error instanceof Error ? error.cause : undefined;
      const causeDetails = cause instanceof Error
        ? `${cause.message}${"code" in cause ? ` (${String(cause.code)})` : ""}`
        : cause === undefined ? "" : String(cause);
      const fallback = result.snapshot.built.models.length > 0
        ? "Retained the last successful model snapshot."
        : "No model snapshot is available; login-required is a placeholder, not evidence of an invalid API key.";
      this.options.onDiscoveryError?.([
        `Magpie model discovery failed: ${modelsEndpoint(this.options.config.baseUrl)}`,
        `${details}${causeDetails ? `: ${causeDetails}` : ""}`,
        fallback,
        "Check the gateway connection, then retry with /magpie refresh.",
      ].join("\n"));
    }
    return normalizeProviderModels(
      result.snapshot.built.models.length > 0
        ? result.snapshot.built.models
        : buildUnavailableProviderModels(),
      this.options.config.baseUrl,
    );
  }

  private register(snapshot: CatalogSnapshot, force: boolean): void {
    const models = snapshot.built.models.length > 0 ? snapshot.built.models : buildUnavailableProviderModels();
    const fingerprint = JSON.stringify(models);
    if (!force && fingerprint === this.registeredFingerprint) return;
    const registration = buildProviderRegistration(this.options.config, models, (ctx) => this.refreshModels(ctx));
    this.options.pi.registerProvider(registration.providerName, registration.config);
    this.registeredFingerprint = fingerprint;
  }
}
