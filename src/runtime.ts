import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Provider } from "@earendil-works/pi-ai";
import { getDiscoveryApiKey } from "./auth.ts";
import { ProviderCatalog, type CatalogRefreshResult, type CatalogSnapshot, type RefreshTarget } from "./catalog.ts";
import { createMagpieProvider, fingerprintModels } from "./registration.ts";
import type { MagpieProviderConfig } from "./types.ts";

export interface ProviderRuntimeOptions {
  pi: ExtensionAPI;
  config: MagpieProviderConfig;
  catalog: ProviderCatalog;
  onDiscoveryError?: (message: string) => void;
}

export class ProviderRuntime {
  private registeredFingerprint?: string;
  private readonly options: ProviderRuntimeOptions;
  readonly provider: Provider;

  constructor(options: ProviderRuntimeOptions) {
    this.options = options;
    this.provider = createMagpieProvider(options);
  }

  async start(): Promise<CatalogSnapshot> {
    const snapshot = await this.options.catalog.load();
    this.register(true);
    return snapshot;
  }

  async refresh(
    target: RefreshTarget = "all",
    mode: "background" | "manual" = "manual",
    getDiscoveryApiKeyFn?: () => Promise<string | undefined>,
  ): Promise<CatalogRefreshResult> {
    const result = await this.options.catalog.refresh(
      target,
      mode,
      getDiscoveryApiKeyFn ?? (() => getDiscoveryApiKey(this.options.config.providerName)),
    );
    if (result.models.updated) this.register(false);
    return result;
  }

  private register(force: boolean): void {
    const models = this.provider.getModels();
    const fingerprint = fingerprintModels([...models]);
    if (!force && fingerprint === this.registeredFingerprint) return;
    this.options.pi.registerProvider(this.provider);
    this.registeredFingerprint = fingerprint;
  }
}
