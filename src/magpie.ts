import { withNetworkTimeout } from "./network.ts";

export type MagpieModelKind = "chat" | "image" | "video";

export interface MagpieModel {
  id: string;
  name: string;
  kind: MagpieModelKind;
  reasoning: boolean;
  efforts: string[];
  nativeEndpoints: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  inputModalities: string[];
  knowsImageInput: boolean;
}

export function modelsEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/models`;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => typeof entry === "string" && entry.trim() !== "" ? [entry] : []);
}

function parseKind(record: Record<string, unknown>): MagpieModelKind {
  const kind = typeof record.kind === "string" ? record.kind.trim().toLowerCase() : "";
  if (kind === "image" || kind === "video") return kind;
  return "chat";
}

function parseEfforts(record: Record<string, unknown>): string[] {
  if (!Array.isArray(record.supported_reasoning_levels)) return [];
  return record.supported_reasoning_levels.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const effort = (entry as Record<string, unknown>).effort;
    return typeof effort === "string" && effort.trim() !== "" ? [effort] : [];
  });
}

function parseModalities(record: Record<string, unknown>): {
  input: string[];
  knowsImageInput: boolean;
} {
  const modalities = record.modalities;
  if (!modalities || typeof modalities !== "object" || Array.isArray(modalities)) {
    return { input: ["text"], knowsImageInput: false };
  }
  const input = stringArray((modalities as Record<string, unknown>).input);
  return {
    input: input.length > 0 ? input : ["text"],
    knowsImageInput: true,
  };
}

function parsePositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function parseMagpieModelEntry(entry: unknown): MagpieModel | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const record = entry as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.trim() === "") return undefined;
  const modalities = parseModalities(record);
  const efforts = parseEfforts(record);
  return {
    id: record.id,
    name: typeof record.display_name === "string" && record.display_name.trim() !== ""
      ? record.display_name
      : record.id,
    kind: parseKind(record),
    reasoning: record.reasoning === true || efforts.length > 0,
    efforts,
    nativeEndpoints: stringArray(record.native_endpoints),
    contextWindow: parsePositiveInt(record.context_window)
      ?? parsePositiveInt(record.context_length)
      ?? parsePositiveInt(record.max_input_tokens),
    maxOutputTokens: parsePositiveInt(record.max_output_tokens),
    inputModalities: modalities.input,
    knowsImageInput: modalities.knowsImageInput,
  };
}

function parseMagpieModelEntries(entries: unknown[]): MagpieModel[] {
  const unique = new Map<string, MagpieModel>();
  for (const entry of entries) {
    const model = parseMagpieModelEntry(entry);
    if (model) unique.set(model.id, model);
  }
  return [...unique.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function parseMagpieModelsCache(payload: unknown): MagpieModel[] {
  if (!Array.isArray(payload)) throw new Error("Magpie model snapshot must be an array");
  const models = parseMagpieModelEntries(payload);
  if (models.length !== payload.length) throw new Error("Magpie model snapshot contains invalid entries");
  return models;
}

export function parseMagpieModelsResponse(payload: unknown): MagpieModel[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { data?: unknown }).data)) {
    throw new Error("Magpie /v1/models response must contain a data array");
  }
  return parseMagpieModelEntries((payload as { data: unknown[] }).data);
}

export async function fetchMagpieModels(
  baseUrl: string,
  headers: Record<string, string> = {},
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<MagpieModel[]> {
  return withNetworkTimeout(async (reqSignal) => {
    const response = await fetch(modelsEndpoint(baseUrl), {
      headers: { Accept: "application/json", ...headers },
      signal: reqSignal,
    });
    if (!response.ok) {
      throw new Error(`Magpie model discovery failed: HTTP ${response.status} ${response.statusText}`);
    }
    return parseMagpieModelsResponse(await response.json());
  }, timeoutMs, "Magpie model discovery", signal);
}
