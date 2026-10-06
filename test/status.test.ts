import test from "node:test";
import assert from "node:assert/strict";
import { formatStatusFailure } from "../src/commands.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";

test("status failure includes configuration and next steps", () => {
  const message = formatStatusFailure(DEFAULT_CONFIG, new TypeError("fetch failed"));

  assert.match(message, /Magpie status failed: fetch failed/);
  assert.match(message, /Provider: magpie/);
  assert.match(message, /Base URL: http:\/\/127\.0\.0\.1:3425\/v1/);
  assert.match(message, /Run \/magpie config/);
});
