import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.ts";
import { ProviderCatalog } from "../src/catalog.ts";
import { ProviderRuntime } from "../src/runtime.ts";
import { buildProviderRegistration } from "../src/registration.ts";
import { buildUnavailableProviderModels } from "../src/provider.ts";
import { registerMagpieCommand } from "../src/commands.ts";
import { getDiscoveryApiKey } from "../src/auth.ts";
import { registerCodexCompatiblePayloadAdapter } from "../src/codex-compat.ts";

export default async function (pi: ExtensionAPI) {
  let config = DEFAULT_CONFIG;
  try {
    const cwd = process.cwd();
    config = loadConfig(cwd);
    const catalog = new ProviderCatalog({
      config,
      getApiKey: () => getDiscoveryApiKey(config.providerName),
    });
    const runtime = new ProviderRuntime({ pi, config, catalog });
    registerCodexCompatiblePayloadAdapter(pi, config.providerName);
    registerMagpieCommand(pi, runtime, catalog);
    await runtime.start();
  } catch (error) {
    registerCodexCompatiblePayloadAdapter(pi, config.providerName);
    registerMagpieCommand(pi);
    pi.registerProvider(config.providerName, buildProviderRegistration(config, buildUnavailableProviderModels()).config);
    console.warn(`[pi-magpie-provider] registered placeholder provider after startup failure: ${error instanceof Error ? error.message : String(error)}`);
  }
}
