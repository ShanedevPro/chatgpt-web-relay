import assert from "node:assert/strict";
import test from "node:test";

import { createConfig, validateProfileName } from "../src/config.js";

test("createConfig defaults to the local extension relay profile", () => {
  const config = createConfig({ rootDir: "/tmp/relay" });

  assert.equal(config.extensionBrowser, "edge");
  assert.equal(config.extensionBrowserMode, "edge-extension");
  assert.equal(config.extensionProfileName, "default");
  assert.match(config.windowsBrowserProfilesDir, /chatgpt-web-relay\/browser-profiles$/);
});

test("createConfig reads optional profile name from the environment", () => {
  const previous = process.env.CHATGPT_RELAY_PROFILE;
  process.env.CHATGPT_RELAY_PROFILE = "account-a";
  try {
    const config = createConfig({ rootDir: "/tmp/relay" });
    assert.equal(config.extensionProfileName, "account-a");
  } finally {
    if (previous === undefined) {
      delete process.env.CHATGPT_RELAY_PROFILE;
    } else {
      process.env.CHATGPT_RELAY_PROFILE = previous;
    }
  }
});

test("validateProfileName allows simple names and rejects unsafe names", () => {
  assert.equal(validateProfileName("plus-account_01"), "plus-account_01");
  assert.throws(() => validateProfileName("../personal-profile"), /Invalid profile name/);
  assert.throws(() => validateProfileName("account a"), /Invalid profile name/);
});
