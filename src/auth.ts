import { readStoredCredential } from "@earendil-works/pi-coding-agent";

export async function getDiscoveryApiKey(providerName: string, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  try {
    const credential = await readStoredCredential(providerName);
    if (credential?.type === "api_key") return credential.key;
    return env.PI_MAGPIE_API_KEY;
  } catch {
    return env.PI_MAGPIE_API_KEY;
  }
}
