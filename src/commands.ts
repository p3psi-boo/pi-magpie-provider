import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG, loadConfig, globalConfigPath, normalizeMagpieBaseUrl, readConfigFile, writeConfigFile, type ConfigLayer } from "./config.ts";
import type { ProviderCatalog, CatalogSnapshot, RefreshTarget, SourceRefreshResult } from "./catalog.ts";
import type { ProviderRuntime } from "./runtime.ts";
import { openModelInspector, openProviderConfig } from "./model-ui.ts";
import { loadProviderSettings } from "./settings.ts";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatStatusFailure(config: ReturnType<typeof loadConfig>, error: unknown): string {
  return [
    `Magpie status failed: ${errorText(error)}`,
    `Provider: ${config.providerName}`,
    `Base URL: ${config.baseUrl}`,
    `Auth required: ${config.authRequired ? "yes" : "no"}`,
    "",
    `Run /login ${config.providerName} to set the gateway URL and API key.`,
  ].join("\n");
}

function redactConfig(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactConfig);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    const isSecretLike = /authorization|api[-_]?key|token|secret|cookie/i.test(key);
    return [key, isSecretLike ? "<redacted>" : redactConfig(entry)];
  }));
}

function age(timestamp?: number): string {
  if (timestamp === undefined) return "missing";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

function capabilityCount(snapshot: CatalogSnapshot, key: "reasoning" | "image"): number {
  return snapshot.built.models.filter((model) => key === "reasoning" ? model.reasoning : model.input.includes("image")).length;
}

export async function runConfig(ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/magpie config connection requires an interactive UI.", "warning");
    return;
  }

  let current = DEFAULT_CONFIG;
  try {
    current = loadConfig(ctx.cwd);
  } catch (error) {
    ctx.ui.notify(`Existing magpie config is invalid; using defaults for repair: ${errorText(error)}`, "warning");
  }

  const path = globalConfigPath();
  let existing: ConfigLayer | undefined;
  try {
    existing = readConfigFile(path);
  } catch (error) {
    ctx.ui.notify(`Existing global magpie config is invalid and will be replaced if you save: ${errorText(error)}`, "warning");
  }
  const defaults = existing ?? current;

  if (existing) ctx.ui.notify(`Editing existing global config at ${path}:\n${JSON.stringify(redactConfig(existing), null, 2)}`, "info");

  const providerNameInput = await ctx.ui.input(`Provider name (leave blank to keep: ${defaults.providerName})`, `leave blank to keep ${defaults.providerName}`);
  if (providerNameInput === undefined) return;
  const baseUrlInput = await ctx.ui.input(`Magpie gateway base URL (leave blank to keep: ${defaults.baseUrl})`, `leave blank to keep ${defaults.baseUrl}`);
  if (baseUrlInput === undefined) return;

  writeConfigFile(path, {
    ...existing,
    providerName: providerNameInput || defaults.providerName,
    baseUrl: normalizeMagpieBaseUrl(baseUrlInput || defaults.baseUrl, defaults.baseUrl),
  });
  ctx.ui.notify(`Saved magpie config to ${path}. Reloading pi to apply connection changes. Run /login ${providerNameInput || defaults.providerName} if this gateway needs a key.`, "info");
  await ctx.reload();
}

function statusText(config: ReturnType<typeof loadConfig>, snapshot: CatalogSnapshot): string {
  return [
    `Magpie provider: ${config.providerName}`,
    `Base URL: ${config.baseUrl}`,
    `Auth required: ${config.authRequired ? "yes" : "no"}`,
    `Chat models: ${snapshot.built.stats.total}`,
    ...(snapshot.built.stats.skipped > 0 ? [`Skipped image/video models: ${snapshot.built.stats.skipped}`] : []),
    `Reasoning models: ${capabilityCount(snapshot, "reasoning")}`,
    `Image-capable models: ${capabilityCount(snapshot, "image")}`,
    `Magpie snapshot: ${age(snapshot.magpieUpdatedAt)}`,
  ].join("\n");
}

function refreshPart(label: string, result: SourceRefreshResult): string {
  if (!result.attempted) return `${label}: not requested`;
  if (result.error) return `${label}: failed (${errorText(result.error)}); retained previous snapshot`;
  return `${label}: ${result.changed ? "updated" : "unchanged"}`;
}

function parseRefreshTarget(value: string | undefined): RefreshTarget | undefined {
  if (!value || value === "all" || value === "models") return "all";
  return undefined;
}

const MAGPIE_HELP = [
  "Magpie provider commands:",
  "  /login magpie             Set gateway URL and API key (Pi login)",
  "  /magpie status            Show provider and model-catalog status",
  "  /magpie refresh           Refresh models from GET /v1/models",
  "  /magpie models            Inspect models and set bounded overrides",
  "  /magpie config            Configure display options",
  "  /magpie config connection Set provider name and default URL",
  "  /magpie help              Show this help",
].join("\n");

export function magpieArgumentCompletions(prefix: string): Array<{ value: string; label: string }> {
  return ["config", "config connection", "status", "refresh", "models", "help"]
    .filter((item) => item.startsWith(prefix))
    .map((value) => ({ value, label: value }));
}

export function registerMagpieCommand(pi: ExtensionAPI, runtime?: ProviderRuntime, catalog?: ProviderCatalog): void {
  pi.registerCommand("magpie", {
    description: "Configure, refresh, and inspect the magpie provider.",
    getArgumentCompletions(prefix) {
      return magpieArgumentCompletions(prefix);
    },
    async handler(args, ctx) {
      const commandArgs = args.trim();
      const [subcommand, option] = commandArgs ? commandArgs.split(/\s+/) : ["help"];
      if (subcommand === "help") {
        ctx.ui.notify(MAGPIE_HELP, "info");
        return;
      }
      if (subcommand === "config") {
        if (option === "connection") return runConfig(ctx);
        if (option) {
          ctx.ui.notify("Usage: /magpie config [connection]", "warning");
          return;
        }
        await openProviderConfig(ctx, loadProviderSettings(ctx.cwd), loadConfig(ctx.cwd));
        return;
      }
      if (!["status", "refresh", "models"].includes(subcommand)) {
        ctx.ui.notify(`${MAGPIE_HELP}\n\nUnknown command: ${subcommand}`, "warning");
        return;
      }
      if (!runtime || !catalog) {
        ctx.ui.notify("Magpie provider is unavailable. Run /login magpie and reload pi.", "error");
        return;
      }
      const config = loadConfig(ctx.cwd);
      if (subcommand === "status") {
        const snapshot = catalog.current() ?? await catalog.load();
        ctx.ui.notify(statusText(config, snapshot), "info");
        return;
      }
      if (subcommand === "refresh") {
        const target = parseRefreshTarget(option);
        if (!target) {
          ctx.ui.notify("Usage: /magpie refresh", "warning");
          return;
        }
        const result = await runtime.refresh(target, "manual", () => ctx.modelRegistry.getApiKeyForProvider(config.providerName));
        const level = result.models.error ? "warning" : "info";
        ctx.ui.notify([
          "Magpie provider refresh complete.",
          refreshPart("Magpie models", result.models),
          `Registered: ${result.snapshot.built.stats.total} chat models.`,
        ].join("\n"), level);
        return;
      }
      if (subcommand === "models") {
        await openModelInspector(ctx, catalog, config, loadProviderSettings(ctx.cwd).showStrictMode);
        return;
      }
    },
  });
}
