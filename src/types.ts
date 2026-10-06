import type { ThinkingLevelMap } from "@earendil-works/pi-ai";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

export type InputModality = "text" | "image";

export interface ProviderModelOverride {
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

export interface ProviderModelOverrideLayer {
  reasoning?: boolean | null;
  contextWindow?: number | null;
  maxTokens?: number | null;
}

export type ProviderModelOverrides = Record<string, ProviderModelOverride>;
export type ProviderModelOverrideLayers = Record<string, ProviderModelOverrideLayer>;

export interface MagpieProviderConfig {
  providerName: string;
  baseUrl: string;
  authRequired: boolean;
  authHeader: boolean;
  headers: Record<string, string>;
  modelOverrides: ProviderModelOverrides;
}

export interface ProviderModelConfigLike {
  id: string;
  name: string;
  reasoning: boolean;
  api?: ProviderModelConfig["api"];
  baseUrl?: string;
  compat?: ProviderModelConfig["compat"];
  thinkingLevelMap?: ThinkingLevelMap;
  input: InputModality[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    tiers?: Array<{
      inputTokensAbove: number;
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    }>;
  };
  contextWindow: number;
  maxTokens: number;
  promptCache?: {
    short: number;
    long?: number;
  };
}
