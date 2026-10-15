import type { ApiKeyAuth, ApiKeyCredential, AuthContext, Credential, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import { persistGatewayConnection, normalizeMagpieBaseUrl } from "./config.ts";
import { discoveryHeaders } from "./discovery.ts";
import { fetchMagpieModels, type MagpieModel } from "./magpie.ts";
import type { MagpieProviderConfig } from "./types.ts";

export const MAGPIE_BASE_URL_ENV = "PI_MAGPIE_BASE_URL";
export const MAGPIE_API_KEY_ENV = "PI_MAGPIE_API_KEY";

export function credentialBaseUrl(credential: Credential | undefined): string | undefined {
  if (credential?.type !== "api_key") return undefined;
  const value = credential.env?.[MAGPIE_BASE_URL_ENV];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function resolveGatewayUrl(
  config: MagpieProviderConfig,
  ctx: Pick<AuthContext, "env">,
  credential?: Credential,
): Promise<string> {
  const fromCredential = credentialBaseUrl(credential);
  if (fromCredential) return normalizeMagpieBaseUrl(fromCredential, config.baseUrl);
  const fromEnv = (await ctx.env(MAGPIE_BASE_URL_ENV))?.trim();
  if (fromEnv) return normalizeMagpieBaseUrl(fromEnv, config.baseUrl);
  return config.baseUrl;
}

export async function getDiscoveryApiKey(providerName: string, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  try {
    const credential = await readStoredCredential(providerName);
    if (credential?.type === "api_key") return credential.key;
    return env[MAGPIE_API_KEY_ENV];
  } catch {
    return env[MAGPIE_API_KEY_ENV];
  }
}

export function createMagpieApiKeyAuth(
  config: MagpieProviderConfig,
  ingest: (models: MagpieModel[]) => Promise<void>,
): ApiKeyAuth {
  return {
    name: "Magpie gateway",
    login: async (interaction: ProviderAuthInteraction): Promise<ApiKeyCredential> => {
      const enteredUrl = await interaction.prompt({
        type: "text",
        message: "Magpie gateway URL",
        placeholder: process.env[MAGPIE_BASE_URL_ENV] ?? config.baseUrl,
      });
      const baseUrl = normalizeMagpieBaseUrl(
        enteredUrl.trim() || process.env[MAGPIE_BASE_URL_ENV] || config.baseUrl,
        config.baseUrl,
      );
      const apiKey = (await interaction.prompt({
        type: "secret",
        message: "Gateway API key (optional if the gateway allows unauthenticated access)",
      })).trim();

      interaction.notify({ type: "progress", message: "Checking magpie catalog…" });
      const models = await fetchMagpieModels(
        baseUrl,
        discoveryHeaders({ ...config, authHeader: Boolean(apiKey) }, apiKey || undefined),
        10_000,
        interaction.signal,
      );
      await ingest(models);
      try {
        persistGatewayConnection(config, {
          baseUrl,
          authRequired: Boolean(apiKey),
          authHeader: Boolean(apiKey),
        });
      } catch {
        config.baseUrl = baseUrl;
        config.authRequired = Boolean(apiKey);
        config.authHeader = Boolean(apiKey);
      }

      return {
        type: "api_key",
        ...(apiKey ? { key: apiKey } : {}),
        env: { [MAGPIE_BASE_URL_ENV]: baseUrl },
      };
    },
    check: async ({ ctx, credential }) => {
      if (credential?.type === "api_key" && credential.key) {
        return { type: "api_key", source: "stored credential" };
      }
      if (await ctx.env(MAGPIE_API_KEY_ENV)) return { type: "api_key", source: MAGPIE_API_KEY_ENV };
      if (!config.authRequired) return { type: "api_key", source: "configured gateway" };
      return undefined;
    },
    resolve: async ({ ctx, credential }) => {
      const baseUrl = await resolveGatewayUrl(config, ctx, credential);
      const apiKey = (credential?.type === "api_key" ? credential.key : undefined)
        ?? await ctx.env(MAGPIE_API_KEY_ENV);
      if (config.authRequired && !apiKey) return undefined;
      return {
        auth: {
          apiKey: apiKey || "magpie",
          baseUrl,
          headers: {
            ...config.headers,
            ...(apiKey && config.authHeader ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
        },
        env: {
          ...(credential?.type === "api_key" ? credential.env : undefined),
          [MAGPIE_BASE_URL_ENV]: baseUrl,
        },
        source: credential?.type === "api_key" && credential.key
          ? "stored credential"
          : apiKey
            ? MAGPIE_API_KEY_ENV
            : "configured gateway",
      };
    },
  };
}
