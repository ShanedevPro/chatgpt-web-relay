import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SAFE_PROFILE_NAME = /^[A-Za-z0-9_-]+$/;

export function validateProfileName(profileName) {
  const normalized = String(profileName ?? "default").trim() || "default";
  if (!SAFE_PROFILE_NAME.test(normalized)) {
    throw new Error(
      `Invalid profile name: ${normalized}. Use only letters, numbers, hyphens, and underscores.`,
    );
  }
  return normalized;
}

function defaultWindowsBrowserProfilesDir() {
  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
      "chatgpt-web-relay",
      "browser-profiles",
    );
  }

  const username = process.env.CHATGPT_RELAY_WINDOWS_USER ?? process.env.USER ?? os.userInfo().username;
  return path.join(
    "/mnt/c/Users",
    username,
    "AppData",
    "Local",
    "chatgpt-web-relay",
    "browser-profiles",
  );
}

function defaultWindowsBrowserPath(browser) {
  if (process.platform === "win32") {
    if (browser === "edge") {
      return "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
    }
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }

  if (browser === "edge") {
    return "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  }
  return "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";
}

function readIntegerEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readOptionalIntegerEnv(name) {
  const raw = process.env[name];
  if (!raw) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function createConfig(overrides = {}) {
  const rootDir = path.resolve(overrides.rootDir ?? packageRoot);
  const localDir = path.resolve(overrides.localDir ?? path.join(rootDir, ".local"));
  const windowsBrowserProfilesDir = path.resolve(
    overrides.windowsBrowserProfilesDir ??
      process.env.CHATGPT_RELAY_WINDOWS_BROWSER_PROFILES ??
      defaultWindowsBrowserProfilesDir(),
  );
  const extensionBrowser =
    overrides.extensionBrowser ?? process.env.CHATGPT_RELAY_EXTENSION_BROWSER ?? "edge";
  const extensionBrowserMode =
    overrides.extensionBrowserMode ??
    process.env.CHATGPT_RELAY_EXTENSION_BROWSER_MODE ??
    `${extensionBrowser}-extension`;
  const extensionProfileName = validateProfileName(
    overrides.extensionProfileName ??
      overrides.browserProfileName ??
      process.env.CHATGPT_RELAY_EXTENSION_PROFILE ??
      process.env.CHATGPT_RELAY_PROFILE ??
      "default",
  );

  return {
    rootDir,
    localDir,
    windowsBrowserProfilesDir,
    windowsExtensionDir: path.resolve(
      overrides.windowsExtensionDir ??
        process.env.CHATGPT_RELAY_WINDOWS_EXTENSION_DIR ??
        path.join(path.dirname(windowsBrowserProfilesDir), "extension"),
    ),
    jobsDir: path.resolve(overrides.jobsDir ?? path.join(localDir, "jobs")),
    resultsDir: path.resolve(overrides.resultsDir ?? path.join(localDir, "results")),
    logsDir: path.resolve(overrides.logsDir ?? path.join(localDir, "logs")),
    chatgptUrl: overrides.chatgptUrl ?? process.env.CHATGPT_RELAY_URL ?? "https://chatgpt.com/",
    extensionBrowser,
    extensionBrowserMode,
    extensionProfileName,
    extensionCdpPort:
      overrides.extensionCdpPort ?? readOptionalIntegerEnv("CHATGPT_RELAY_EXTENSION_CDP_PORT"),
    windowsChromePath:
      overrides.windowsChromePath ??
      process.env.CHATGPT_RELAY_WINDOWS_CHROME ??
      defaultWindowsBrowserPath("chrome"),
    windowsEdgePath:
      overrides.windowsEdgePath ??
      process.env.CHATGPT_RELAY_WINDOWS_EDGE ??
      defaultWindowsBrowserPath("edge"),
    port: overrides.port ?? readIntegerEnv("CHATGPT_RELAY_PORT", 8787),
    responseTimeoutMs:
      overrides.responseTimeoutMs ?? readIntegerEnv("CHATGPT_RELAY_RESPONSE_TIMEOUT_MS", 180000),
    stableIntervalMs:
      overrides.stableIntervalMs ?? readIntegerEnv("CHATGPT_RELAY_STABLE_INTERVAL_MS", 1000),
    stableReads: overrides.stableReads ?? readIntegerEnv("CHATGPT_RELAY_STABLE_READS", 5),
  };
}

export const defaultConfig = createConfig();
