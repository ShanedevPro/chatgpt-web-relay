import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildChromeExtensionLaunchArgs,
  classifyExtensionDoctorStatus,
  planChatGptTabNormalization,
  relayExtensionDefaults,
} from "../src/extensionLauncher.js";
import { SUPPORTED_CONTENT_VERSION } from "../src/extensionBroker.js";

test("relayExtensionDefaults returns the default profile and extension paths", () => {
  const defaults = relayExtensionDefaults({
    rootDir: "/home/example/chatgpt-web-relay",
    windowsBrowserProfilesDir: "/mnt/c/Users/example/AppData/Local/chatgpt-web-relay/browser-profiles",
  });

  assert.equal(defaults.browser, "edge");
  assert.equal(defaults.mode, "edge-extension");
  assert.equal(defaults.profileName, "default");
  assert.equal(
    defaults.profileDir,
    "/mnt/c/Users/example/AppData/Local/chatgpt-web-relay/browser-profiles/edge-extension/default",
  );
  assert.equal(defaults.extensionSourceDir, "/home/example/chatgpt-web-relay/extension");
  assert.equal(defaults.extensionInstallDir, "/mnt/c/Users/example/AppData/Local/chatgpt-web-relay/extension");
  assert.equal(defaults.cdpPort, 9224);
});

test("relayExtensionDefaults supports explicit Chrome extension profiles", () => {
  const defaults = relayExtensionDefaults({
    extensionBrowser: "chrome",
    extensionProfileName: "account-a",
    rootDir: "/home/example/chatgpt-web-relay",
    windowsBrowserProfilesDir: "/mnt/c/Users/example/AppData/Local/chatgpt-web-relay/browser-profiles",
  });

  assert.equal(defaults.browser, "chrome");
  assert.equal(defaults.mode, "chrome-extension");
  assert.equal(defaults.cdpPort, 9223);
  assert.equal(
    defaults.profileDir,
    "/mnt/c/Users/example/AppData/Local/chatgpt-web-relay/browser-profiles/chrome-extension/account-a",
  );
});

test("buildChromeExtensionLaunchArgs includes extension flags and avoids session restore", () => {
  const args = buildChromeExtensionLaunchArgs({
    cdpPort: 9223,
    profileDir: "C:\\Users\\example\\AppData\\Local\\chatgpt-web-relay\\browser-profiles\\chrome-extension\\default",
    extensionDir: "C:\\Users\\example\\AppData\\Local\\chatgpt-web-relay\\extension",
    chatgptUrl: "https://chatgpt.com/",
  });

  assert.deepEqual(args, [
    "--remote-debugging-port=9223",
    "--remote-debugging-address=0.0.0.0",
    "--user-data-dir=C:\\Users\\example\\AppData\\Local\\chatgpt-web-relay\\browser-profiles\\chrome-extension\\default",
    "--load-extension=C:\\Users\\example\\AppData\\Local\\chatgpt-web-relay\\extension",
    "--disable-extensions-except=C:\\Users\\example\\AppData\\Local\\chatgpt-web-relay\\extension",
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    "https://chatgpt.com/",
  ]);
  assert.equal(args.some((arg) => arg.includes("restore-last-session")), false);
});

test("planChatGptTabNormalization plans existing ChatGPT tabs and a fresh one", () => {
  assert.deepEqual(
    planChatGptTabNormalization(
      [
        { id: "tab-1", url: "https://chatgpt.com/" },
        { id: "tab-2", url: "https://chatgpt.com/c/old" },
        { id: "tab-3", url: "chrome://extensions/" },
      ],
      "https://chatgpt.com/",
    ),
    {
      closeTargetIds: ["tab-1", "tab-2"],
      openUrl: "https://chatgpt.com/",
    },
  );
});

test("classifyExtensionDoctorStatus distinguishes common startup failures", () => {
  assert.equal(classifyExtensionDoctorStatus({ serverReachable: false }), "server_down");
  assert.equal(
    classifyExtensionDoctorStatus({
      serverReachable: true,
      chromeRunning: false,
      extensionPathExists: true,
    }),
    "chrome_not_running",
  );
  assert.equal(
    classifyExtensionDoctorStatus({
      serverReachable: true,
      chromeRunning: true,
      extensionPathExists: false,
    }),
    "extension_missing",
  );
  assert.equal(
    classifyExtensionDoctorStatus({
      serverReachable: true,
      chromeRunning: true,
      extensionPathExists: true,
      chatgptTabFound: false,
    }),
    "chatgpt_tab_missing",
  );
  assert.equal(
    classifyExtensionDoctorStatus({
      serverReachable: true,
      chromeRunning: true,
      extensionPathExists: true,
      chatgptTabFound: true,
      contentScriptLoaded: false,
    }),
    "extension_not_loaded",
  );
  assert.equal(
    classifyExtensionDoctorStatus({
      serverReachable: true,
      chromeRunning: true,
      extensionPathExists: true,
      chatgptTabFound: true,
      contentScriptLoaded: true,
      workers: [],
    }),
    "worker_not_registered",
  );
  assert.equal(
    classifyExtensionDoctorStatus({
      serverReachable: true,
      chromeRunning: true,
      extensionPathExists: true,
      chatgptTabFound: false,
      contentScriptLoaded: true,
      workers: [{ status: "ready", pageState: { loginVisible: true } }],
    }),
    "chatgpt_logged_out",
  );
  assert.equal(
    classifyExtensionDoctorStatus({
      serverReachable: true,
      chromeRunning: true,
      extensionPathExists: true,
      chatgptTabFound: true,
      contentScriptLoaded: true,
      workers: [{ status: "ready", pageState: { loginVisible: true } }],
    }),
    "chatgpt_logged_out",
  );
  assert.equal(
    classifyExtensionDoctorStatus({
      serverReachable: true,
      chromeRunning: true,
      extensionPathExists: true,
      chatgptTabFound: true,
      contentScriptLoaded: true,
      workers: [{ status: "ready", pageState: { verificationVisible: true } }],
    }),
    "chatgpt_verification_required",
  );
  assert.equal(
    classifyExtensionDoctorStatus({
      serverReachable: true,
      chromeRunning: true,
      extensionPathExists: true,
      chatgptTabFound: true,
      contentScriptLoaded: true,
      workers: [{ status: "outdated", pageState: { contentVersion: "old" } }],
    }),
    "extension_outdated",
  );
  assert.equal(
    classifyExtensionDoctorStatus({
      serverReachable: true,
      chromeRunning: true,
      extensionPathExists: true,
      chatgptTabFound: true,
      contentScriptLoaded: true,
      workers: [{ status: "ready", pageState: { editorFound: true, loginVisible: false } }],
    }),
    "worker_ready",
  );
  assert.equal(
    classifyExtensionDoctorStatus({
      serverReachable: true,
      chromeRunning: true,
      extensionPathExists: true,
      chatgptTabFound: true,
      contentScriptLoaded: false,
      contentScriptLoadedFromPage: false,
      workers: [{ status: "ready", pageState: { editorFound: true, loginVisible: false } }],
    }),
    "worker_ready",
  );
  assert.equal(
    classifyExtensionDoctorStatus({
      serverReachable: true,
      chromeRunning: true,
      extensionPathExists: true,
      chatgptTabFound: false,
      contentScriptLoaded: true,
      workers: [{ status: "ready", pageState: { editorFound: false, loginVisible: false } }],
    }),
    "worker_ready",
  );
});

test("consumer docs point other agents to relay:start", async () => {
  const guide = await readFile(new URL("../docs/consumer-integration-guide.md", import.meta.url), "utf8");

  assert.match(guide, /npm run relay:start -- --port 8787/);
  assert.match(guide, /manual extension loading/i);
});

test("extension manifest uses valid wildcard match patterns for report frames", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"),
  );
  const patterns = [
    ...(manifest.host_permissions ?? []),
    ...(manifest.content_scripts ?? []).flatMap((script) => script.matches ?? []),
  ];

  assert.equal(
    patterns.some((pattern) => pattern.includes("connector_openai_deep_research")),
    false,
  );
  assert.ok(patterns.includes("https://*.web-sandbox.oaiusercontent.com/*"));
});

test("extension injected script observes ChatGPT responses without replacing them", async () => {
  const injected = await readFile(new URL("../extension/injected.js", import.meta.url), "utf8");

  assert.match(injected, /function inspectStreamingResponse/);
  assert.match(injected, /response\.clone\(\)/);
  assert.match(injected, /return response;/);
  assert.doesNotMatch(injected, /wrapStreamingResponse\(response, url\)/);
});

test("extension injected script keeps a bounded conversation response preview", async () => {
  const injected = await readFile(new URL("../extension/injected.js", import.meta.url), "utf8");

  assert.match(injected, /responseTextPreview/);
  assert.match(injected, /textPreview/);
  assert.match(injected, /slice\(0, 2000\)/);
});

test("extension content prepares a new conversation before requiring the prompt editor", async () => {
  const content = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");
  const processTaskStart = content.indexOf("async function processTask(task)");
  const processTaskEnd = content.indexOf("async function pollForTask()", processTaskStart);
  const processTaskSource = content.slice(processTaskStart, processTaskEnd);

  assert.ok(processTaskStart >= 0);
  assert.ok(processTaskSource.indexOf("await ensureConversationTarget") < processTaskSource.indexOf("assertPageReadyForTask"));
});

test("extension content sends progress heartbeats while waiting on long jobs", async () => {
  const content = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");
  const waitForAnswerStart = content.indexOf("async function waitForAssistantAnswer");
  const waitForAnswerEnd = content.indexOf("async function processTask", waitForAnswerStart);
  const waitForImagesStart = content.indexOf("async function waitForGeneratedImages");
  const waitForImagesEnd = content.indexOf("function inferImageContentType", waitForImagesStart);

  assert.match(content, /PROGRESS_REPORT_INTERVAL_MS/);
  assert.match(content, /async function reportTaskProgress/);
  assert.match(content.slice(waitForAnswerStart, waitForAnswerEnd), /await reportTaskProgress/);
  assert.match(content.slice(waitForImagesStart, waitForImagesEnd), /await reportTaskProgress/);
});

test("extension content fails Deep Research quickly when research mode is not activated", async () => {
  const content = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");
  const waitForAnswerStart = content.indexOf("async function waitForAssistantAnswer");
  const waitForAnswerEnd = content.indexOf("async function processTask", waitForAnswerStart);
  const catchStart = content.indexOf("} catch (error) {", waitForAnswerEnd);
  const catchEnd = content.indexOf("} finally {", catchStart);

  assert.match(content, /DEEP_RESEARCH_ACTIVATION_GRACE_MS/);
  assert.match(content.slice(waitForAnswerStart, waitForAnswerEnd), /backendDoneWithoutResearchAtMs/);
  assert.match(content.slice(waitForAnswerStart, waitForAnswerEnd), /Deep Research did not activate/);
  assert.match(content.slice(catchStart, catchEnd), /activationFailure/);
});

test("extension content does not treat checked Deep Research menu items as selected mode", async () => {
  const content = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");
  const selectedStart = content.indexOf("function isDeepResearchSelected(element)");
  const selectedEnd = content.indexOf("function isCreateImageSelected", selectedStart);
  const selectedSource = content.slice(selectedStart, selectedEnd);

  assert.ok(selectedStart >= 0);
  assert.doesNotMatch(selectedSource, /isPressed\(element\)/);
  assert.match(selectedSource, /isMenuLikeOption/);
  assert.match(selectedSource, /isDeepResearchModeChip/);
});

test("extension content selects tools only from the opened plus menu", async () => {
  const content = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");
  const deepStart = content.indexOf("async function selectDeepResearch");
  const deepEnd = content.indexOf("async function selectCreateImage", deepStart);
  const imageStart = deepEnd;
  const imageEnd = content.indexOf("function isFreshConversationUrl", imageStart);

  assert.match(content, /function findToolMenuItem/);
  assert.match(content, /function isToolMenuCandidate/);
  assert.match(content.slice(deepStart, deepEnd), /findToolMenuItem\(shared\.isDeepResearchControlLabel\)/);
  assert.match(content.slice(imageStart, imageEnd), /findToolMenuItem\(shared\.isCreateImageControlLabel\)/);
});

test("extension content treats ChatGPT connector hints as Deep Research activation evidence", async () => {
  const content = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");
  const waitForAnswerStart = content.indexOf("async function waitForAssistantAnswer");
  const waitForAnswerEnd = content.indexOf("async function processTask", waitForAnswerStart);
  const waitForAnswerSource = content.slice(waitForAnswerStart, waitForAnswerEnd);

  assert.match(content, /function hasDeepResearchActivationEvidence/);
  assert.match(waitForAnswerSource, /hasDeepResearchActivationEvidence/);
  assert.match(content, /connector_openai_deep_research/);
});

test("extension content can safely click a Deep Research Start button while waiting", async () => {
  const content = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");
  const waitForAnswerStart = content.indexOf("async function waitForAssistantAnswer");
  const waitForAnswerEnd = content.indexOf("async function processTask", waitForAnswerStart);
  const waitForAnswerSource = content.slice(waitForAnswerStart, waitForAnswerEnd);

  assert.match(content, /function isDeepResearchStartControlLabel/);
  assert.match(content, /function clickDeepResearchStartIfVisible/);
  assert.match(content, /dictation\|voice/);
  assert.match(waitForAnswerSource, /clickDeepResearchStartIfVisible/);
});

test("extension content reports Deep Research wait debug evidence", async () => {
  const content = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");
  const waitForAnswerStart = content.indexOf("async function waitForAssistantAnswer");
  const waitForAnswerEnd = content.indexOf("async function processTask", waitForAnswerStart);
  const waitForAnswerSource = content.slice(waitForAnswerStart, waitForAnswerEnd);

  assert.match(content, /function deepResearchWaitDebugEvidence/);
  assert.match(waitForAnswerSource, /deepResearchWaitDebugEvidence/);
  assert.match(waitForAnswerSource, /deepResearchWaitDebug/);
});

test("extension content submits prompts with user-like click events", async () => {
  const content = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");
  const submitStart = content.indexOf("async function submitPrompt");
  const submitEnd = content.indexOf("function latestAssistantText", submitStart);
  const submitSource = content.slice(submitStart, submitEnd);

  assert.ok(submitStart >= 0);
  assert.match(submitSource, /await clickLikeUser\(sendButton\)/);
  assert.doesNotMatch(submitSource, /sendButton\.click\(\)/);
});

test("extension content version matches the server-supported worker version", async () => {
  const content = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");

  assert.match(content, new RegExp(`CONTENT_VERSION = "${SUPPORTED_CONTENT_VERSION}"`));
});
