import type { MagpieModel } from "./magpie.ts";
import type { ProviderModelConfigLike } from "./types.ts";

const CLAUDE_MODEL = /^claude(?:-|$)/;

function modelName(id: string): string {
  return id.slice(id.lastIndexOf("/") + 1);
}

export function isClaudeModel(id: string): boolean {
  return CLAUDE_MODEL.test(modelName(id));
}

/**
 * Pick a model-level API from magpie's native_endpoints.
 *
 * Responses wins when a model is served natively on both Responses and
 * Messages, matching magpie's own Pi models.json writer. Routing groups and
 * translated models omit native_endpoints and stay on the provider default
 * (openai-completions).
 */
function apiFromNativeEndpoints(endpoints: string[]): ProviderModelConfigLike["api"] | undefined {
  if (endpoints.includes("/v1/responses")) return "openai-responses";
  if (endpoints.includes("/v1/messages")) return "anthropic-messages";
  return undefined;
}

export function modelApi(model: MagpieModel): ProviderModelConfigLike["api"] | undefined {
  return apiFromNativeEndpoints(model.nativeEndpoints);
}
