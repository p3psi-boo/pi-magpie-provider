import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PROVIDER_SETTINGS, loadProviderSettings, saveProviderSettings } from "../src/settings.ts";

async function withSettingsTree<T>(fn: (cwd: string, agentDir: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "pi-magpie-settings-"));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  try {
    return await fn(cwd, agentDir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const namespace = "pi-magpie-provider";

test("uses default display settings", async () => {
  await withSettingsTree(async (cwd, agentDir) => {
    assert.deepEqual(loadProviderSettings(cwd, agentDir), DEFAULT_PROVIDER_SETTINGS);
  });
});

test("project settings override the global display settings", async () => {
  await withSettingsTree(async (cwd, agentDir) => {
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({
      [namespace]: { showStrictMode: false },
    }));
    await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({
      [namespace]: { showStrictMode: true },
    }));

    const settings = loadProviderSettings(cwd, agentDir);
    assert.equal(settings.showStrictMode, true);
  });
});

test("saves package settings to the existing project settings file", async () => {
  await withSettingsTree(async (cwd, agentDir) => {
    await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ unrelated: true }));
    const path = saveProviderSettings(cwd, { showStrictMode: true });

    assert.equal(path, join(cwd, ".pi", "settings.json"));
    assert.deepEqual(loadProviderSettings(cwd, agentDir), {
      showStrictMode: true,
    });
  });
});

test("rejects unsupported provider settings", async () => {
  await withSettingsTree(async (cwd, agentDir) => {
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({
      [namespace]: { showStrictMode: "yes" },
    }));
    assert.throws(() => loadProviderSettings(cwd, agentDir), /pi-magpie-provider/);
  });
});
