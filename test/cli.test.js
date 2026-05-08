import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs } from "../src/cli.js";

test("parseArgs reads relay browser and profile options", () => {
  const { options, positional } = parseArgs([
    "--browser",
    "chrome",
    "--profile",
    "account-a",
    "hello",
  ]);

  assert.deepEqual(options, {
    browser: "chrome",
    profile: "account-a",
  });
  assert.deepEqual(positional, ["hello"]);
});

test("parseArgs reads deep mode", () => {
  const { options, positional } = parseArgs(["--deep", "research prompt"]);

  assert.deepEqual(options, { mode: "deep_research" });
  assert.deepEqual(positional, ["research prompt"]);
});

test("parseArgs reads image mode", () => {
  const { options, positional } = parseArgs(["--image", "image prompt"]);

  assert.deepEqual(options, { mode: "create_image" });
  assert.deepEqual(positional, ["image prompt"]);
});

test("parseArgs reads conversation target", () => {
  const { options, positional } = parseArgs(["--conversation", "current", "follow up"]);

  assert.deepEqual(options, { conversation: "current" });
  assert.deepEqual(positional, ["follow up"]);
});

test("parseArgs reads relay launch options", () => {
  const { options, positional } = parseArgs([
    "--port",
    "8787",
    "--profile",
    "account-a",
    "--browser",
    "edge",
    "--cdp-port",
    "9223",
  ]);

  assert.deepEqual(options, {
    port: 8787,
    profile: "account-a",
    browser: "edge",
    cdpPort: 9223,
  });
  assert.deepEqual(positional, []);
});
