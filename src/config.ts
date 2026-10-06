import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  MagpieProviderConfig,
  ProviderModelOverride,
  ProviderModelOverrideLayer,
  ProviderModelOverrideLayers,
  ProviderModelOverrides,
} from "./types.ts";

export type ConfigLayer = Partial<MagpieProviderConfig>;

const PACKAGE_DIR_NAME = "pi-magpie-provider";
export const CONTEXT_WINDOW_PRESETS = [128000, 272000, 512000, 1000000] as const;
export const MAX_TOKEN_PRESETS = [4096, 8192, 16384, 32768, 65536, 128000] as const;

export const DEFAULT_CONFIG: MagpieProviderConfig = {
  providerName: "magpie",
  baseUrl: "http://127.0.0.1:3425/v1",
  authRequired: true,
  authHeader: true,
  headers: {},
  modelOverrides: {},
};

export function globalConfigPath(): string {
  return join(homedir(), ".pi", "agent", PACKAGE_DIR_NAME, "config.json");
}

export function projectConfigPath(cwd: string): string {
  return join(cwd, ".pi", PACKAGE_DIR_NAME, "config.json");
}

export function cacheDir(): string {
  return join(homedir(), ".cache", PACKAGE_DIR_NAME);
}

export function providerCacheKey(config: Pick<MagpieProviderConfig, "providerName" | "baseUrl">): string {
  return Buffer.from(`${config.providerName}\n${config.baseUrl}`).toString("base64url");
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function normalizeConfig(config: MagpieProviderConfig): MagpieProviderConfig {
  return {
    ...config,
    authHeader: config.authRequired ? config.authHeader : false,
  };
}

function safeProjectConfig(projectConfig?: ConfigLayer): ConfigLayer | undefined {
  if (!projectConfig) return undefined;
  return {
    ...(projectConfig.modelOverrides !== undefined ? { modelOverrides: projectConfig.modelOverrides } : {}),
  };
}

function mergeModelOverrides(
  base: ProviderModelOverrides,
  layer: ProviderModelOverrideLayers | undefined,
): ProviderModelOverrides {
  if (!layer) return base;
  const merged = { ...base };
  for (const [modelId, override] of Object.entries(layer)) {
    const next = { ...merged[modelId] } as ProviderModelOverride;
    for (const field of ["reasoning", "contextWindow", "maxTokens"] as const) {
      const value = override[field];
      if (value === null) delete next[field];
      else if (value !== undefined) (next as Record<string, boolean | number>)[field] = value;
    }
    if (Object.keys(next).length === 0) delete merged[modelId];
    else merged[modelId] = next;
  }
  return merged;
}

function projectConfigLayer(value: unknown, path: string): ConfigLayer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Project config file must contain a JSON object: ${path}`);
  }

  const record = value as Record<string, unknown>;
  const modelOverrides = record.modelOverrides === undefined
    ? undefined
    : parseModelOverrides(record.modelOverrides, "project");

  return safeProjectConfig({ ...record, ...(modelOverrides ? { modelOverrides } : {}) } as ConfigLayer) ?? {};
}

function mergeLayer(base: MagpieProviderConfig, layer?: ConfigLayer): MagpieProviderConfig {
  if (!layer) return base;
  return {
    ...base,
    ...layer,
    headers: { ...base.headers, ...(layer.headers ?? {}) },
    modelOverrides: mergeModelOverrides(base.modelOverrides, layer.modelOverrides),
  };
}

function envLayer(env: NodeJS.ProcessEnv): ConfigLayer {
  const authRequired = parseBooleanEnv(env.PI_MAGPIE_AUTH_REQUIRED);
  const authHeader = parseBooleanEnv(env.PI_MAGPIE_AUTH_HEADER);
  return {
    ...(env.PI_MAGPIE_BASE_URL ? { baseUrl: env.PI_MAGPIE_BASE_URL } : {}),
    ...(env.PI_MAGPIE_PROVIDER_NAME ? { providerName: env.PI_MAGPIE_PROVIDER_NAME } : {}),
    ...(authRequired !== undefined ? { authRequired } : {}),
    ...(authHeader !== undefined ? { authHeader } : {}),
  };
}

export function mergeConfigLayers(
  globalConfig?: ConfigLayer,
  projectConfig?: ConfigLayer,
  env: NodeJS.ProcessEnv = process.env,
): MagpieProviderConfig {
  const envConfig = envLayer(env);
  return normalizeConfig(mergeLayer(mergeLayer(mergeLayer(DEFAULT_CONFIG, globalConfig), safeProjectConfig(projectConfig)), envConfig));
}

function isStringMap(value: unknown): value is Record<string, string> {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === "string");
}

function isAllowedPreset(value: unknown, presets: readonly number[]): value is number {
  return typeof value === "number" && presets.includes(value);
}

function parseModelOverrides(value: unknown, scope: string): ProviderModelOverrideLayers {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`modelOverrides must be an object in ${scope} config file`);
  }

  const parsed: ProviderModelOverrideLayers = {};
  for (const [modelId, rawOverride] of Object.entries(value)) {
    if (!modelId.trim()) throw new Error(`modelOverrides keys must be non-empty model IDs in ${scope} config file`);
    if (!rawOverride || typeof rawOverride !== "object" || Array.isArray(rawOverride)) {
      throw new Error(`modelOverrides.${modelId} must be an object in ${scope} config file`);
    }

    const record = rawOverride as Record<string, unknown>;
    const unknown = Object.keys(record).filter(
      (key) => key !== "reasoning" && key !== "contextWindow" && key !== "maxTokens",
    );
    if (unknown.length > 0) {
      throw new Error(`modelOverrides.${modelId} contains unsupported fields: ${unknown.join(", ")}`);
    }
    const nullable = scope === "project";
    if (record.reasoning !== undefined && typeof record.reasoning !== "boolean" && !(nullable && record.reasoning === null)) {
      throw new Error(`modelOverrides.${modelId}.reasoning must be a boolean${nullable ? " or null" : ""} in ${scope} config file`);
    }
    const presets = { contextWindow: CONTEXT_WINDOW_PRESETS, maxTokens: MAX_TOKEN_PRESETS };
    for (const field of ["contextWindow", "maxTokens"] as const) {
      const value = record[field];
      if (value !== undefined && !isAllowedPreset(value, presets[field]) && !(nullable && value === null)) {
        throw new Error(`modelOverrides.${modelId}.${field} must be one of ${presets[field].join(", ")}${nullable ? " or null" : ""} in ${scope} config file`);
      }
    }

    parsed[modelId] = {
      ...(record.reasoning !== undefined ? { reasoning: record.reasoning as boolean | null } : {}),
      ...(record.contextWindow !== undefined ? { contextWindow: record.contextWindow as number | null } : {}),
      ...(record.maxTokens !== undefined ? { maxTokens: record.maxTokens as number | null } : {}),
    } satisfies ProviderModelOverrideLayer;
  }
  return parsed;
}

function validateConfigLayer(value: unknown, path: string): ConfigLayer {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Config file must contain a JSON object: ${path}`);
  }

  const record = value as Record<string, unknown>;
  const stringFields = ["providerName", "baseUrl"];
  for (const field of stringFields) {
    if (record[field] !== undefined && typeof record[field] !== "string") {
      throw new Error(`${field} must be a string in config file: ${path}`);
    }
  }

  const booleanFields = ["authRequired", "authHeader"];
  for (const field of booleanFields) {
    if (record[field] !== undefined && typeof record[field] !== "boolean") {
      throw new Error(`${field} must be a boolean in config file: ${path}`);
    }
  }

  if (record.headers !== undefined && !isStringMap(record.headers)) {
    throw new Error(`headers must be an object with string values in config file: ${path}`);
  }
  const modelOverrides = record.modelOverrides === undefined
    ? undefined
    : parseModelOverrides(record.modelOverrides, "global");

  return { ...record, ...(modelOverrides ? { modelOverrides } : {}) } as ConfigLayer;
}

export function readConfigFile(path: string): ConfigLayer | undefined {
  if (!existsSync(path)) return undefined;
  return validateConfigLayer(JSON.parse(readFileSync(path, "utf8")), path);
}

export function readProjectConfigFile(path: string): ConfigLayer | undefined {
  if (!existsSync(path)) return undefined;
  return projectConfigLayer(JSON.parse(readFileSync(path, "utf8")), path);
}

export function loadConfig(cwd: string, env: NodeJS.ProcessEnv = process.env): MagpieProviderConfig {
  return mergeConfigLayers(readConfigFile(globalConfigPath()), readProjectConfigFile(projectConfigPath(cwd)), env);
}

export function writeConfigFile(path: string, config: ConfigLayer): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function loadModelOverrideLayers(cwd: string): {
  global: ProviderModelOverrideLayers;
  project: ProviderModelOverrideLayers;
} {
  return {
    global: (readConfigFile(globalConfigPath())?.modelOverrides ?? {}) as ProviderModelOverrideLayers,
    project: (readProjectConfigFile(projectConfigPath(cwd))?.modelOverrides ?? {}) as ProviderModelOverrideLayers,
  };
}

export function saveModelOverride(
  cwd: string,
  modelId: string,
  override: ProviderModelOverrideLayer,
): { path: string; overrides: ProviderModelOverrideLayers } {
  const path = projectConfigPath(cwd);
  let raw: Record<string, unknown> = {};
  if (existsSync(path)) {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Config file must contain a JSON object: ${path}`);
    }
    raw = parsed as Record<string, unknown>;
  }

  const existing = raw.modelOverrides === undefined
    ? {}
    : parseModelOverrides(raw.modelOverrides, "project");
  const next = { ...existing };
  if (Object.keys(override).length === 0) delete next[modelId];
  else next[modelId] = override;
  writeConfigFile(path, { ...raw, modelOverrides: next } as ConfigLayer);
  return { path, overrides: next };
}
