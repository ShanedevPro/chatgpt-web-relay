import { spawn } from "node:child_process";
import { access, cp, mkdir, rm } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const DEFAULT_PROFILE_NAME = "default";
const DEFAULT_EXTENSION_BROWSER = "edge";
const DEFAULT_WORKER_TIMEOUT_MS = 30000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function localRelayRootFromProfilesDir(windowsBrowserProfilesDir) {
  return path.dirname(windowsBrowserProfilesDir);
}

function defaultCdpPortForBrowser(browser) {
  return browser === "edge" ? 9224 : 9223;
}

export function relayExtensionDefaults(config = {}) {
  const profileName = config.extensionProfileName ?? DEFAULT_PROFILE_NAME;
  const browser = config.extensionBrowser ?? DEFAULT_EXTENSION_BROWSER;
  const mode = config.extensionBrowserMode ?? `${browser}-extension`;
  const cdpPort = config.extensionCdpPort ?? defaultCdpPortForBrowser(browser);
  const relayRoot = localRelayRootFromProfilesDir(config.windowsBrowserProfilesDir);

  return {
    browser,
    mode,
    profileName,
    cdpPort,
    profileDir: path.join(config.windowsBrowserProfilesDir, mode, profileName),
    extensionSourceDir: path.join(config.rootDir, "extension"),
    extensionInstallDir: config.windowsExtensionDir ?? path.join(relayRoot, "extension"),
  };
}

export function buildChromeExtensionLaunchArgs({
  cdpPort,
  profileDir,
  extensionDir,
  chatgptUrl,
}) {
  return [
    `--remote-debugging-port=${cdpPort}`,
    "--remote-debugging-address=0.0.0.0",
    `--user-data-dir=${profileDir}`,
    `--load-extension=${extensionDir}`,
    `--disable-extensions-except=${extensionDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--new-window",
    chatgptUrl,
  ];
}

export function planChatGptTabNormalization(targets, chatgptUrl) {
  return {
    closeTargetIds: targets
      .filter((target) => String(target.url ?? "").startsWith(chatgptUrl))
      .map((target) => target.id)
      .filter(Boolean),
    openUrl: chatgptUrl,
  };
}

export function classifyExtensionDoctorStatus(report = {}) {
  if (!report.serverReachable) {
    return "server_down";
  }
  if (!report.chromeRunning) {
    return "chrome_not_running";
  }
  if (!report.extensionPathExists) {
    return "extension_missing";
  }

  const workers = Array.isArray(report.workers) ? report.workers : [];
  const activeWorkers = workers.filter(
    (worker) => worker.status !== "stale" && worker.status !== "outdated",
  );
  if (activeWorkers.some((worker) => worker.pageState?.loginVisible)) {
    return "chatgpt_logged_out";
  }
  if (activeWorkers.some((worker) => worker.pageState?.verificationVisible)) {
    return "chatgpt_verification_required";
  }
  if (activeWorkers.some((worker) => worker.status === "ready")) {
    return "worker_ready";
  }
  if (!report.chatgptTabFound) {
    return "chatgpt_tab_missing";
  }
  if (!report.contentScriptLoaded) {
    return "extension_not_loaded";
  }
  if (workers.some((worker) => worker.status === "outdated")) {
    return "extension_outdated";
  }
  if (activeWorkers.length === 0) {
    return "worker_not_registered";
  }
  return "worker_not_ready";
}

function relayBaseUrl(config) {
  return `http://127.0.0.1:${config.port}`;
}

async function readJson(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }
  return payload;
}

async function maybeWindowsPath(filePath) {
  if (process.platform !== "linux" || !path.isAbsolute(filePath)) {
    return filePath;
  }

  return new Promise((resolve) => {
    const child = spawn("wslpath", ["-w", filePath], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", () => resolve(filePath));
    child.on("close", (code) => resolve(code === 0 && output.trim() ? output.trim() : filePath));
  });
}

function powerShellString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
      }
    });
  });
}

function extensionBrowserPath(config, browser) {
  if (browser === "edge") {
    return config.windowsEdgePath;
  }
  if (browser === "chrome") {
    return config.windowsChromePath;
  }
  throw new Error(`Unsupported extension browser: ${browser}`);
}

function windowsExecutableName(executablePath) {
  return path.win32.basename(String(executablePath));
}

async function stopWindowsBrowserProfile(executableName, profileDir) {
  const script = `
$profileDir = ${powerShellString(profileDir)}
$browserName = ${powerShellString(executableName)}
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq $browserName -and $_.CommandLine -and $_.CommandLine.Contains($profileDir) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
`;
  await runPowerShell(script).catch(() => "");
}

async function isWindowsBrowserProfileRunning(executableName, profileDir) {
  const script = `
$profileDir = ${powerShellString(profileDir)}
$browserName = ${powerShellString(executableName)}
$process = Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq $browserName -and $_.CommandLine -and $_.CommandLine.Contains($profileDir) } |
  Select-Object -First 1
if ($process) { 'true' } else { 'false' }
`;
  return (await runPowerShell(script).catch(() => "false")) === "true";
}

async function readWindowsCdpTargets(cdpPort) {
  const script = `
try {
  (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:${cdpPort}/json -TimeoutSec 2).Content
} catch {
  ''
}
`;
  const output = await runPowerShell(script).catch(() => "");
  if (!output) {
    return [];
  }
  try {
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

async function closeWindowsCdpTarget(cdpPort, targetId) {
  const script = `
try {
  Invoke-WebRequest -UseBasicParsing http://127.0.0.1:${cdpPort}/json/close/${targetId} -TimeoutSec 2 | Out-Null
} catch {}
`;
  await runPowerShell(script).catch(() => "");
}

async function openWindowsCdpTarget(cdpPort, targetUrl) {
  const script = `
try {
  $targetUrl = [Uri]::EscapeDataString(${powerShellString(targetUrl)})
  Invoke-WebRequest -UseBasicParsing -Method PUT "http://127.0.0.1:${cdpPort}/json/new?$targetUrl" -TimeoutSec 2 | Out-Null
} catch {}
`;
  await runPowerShell(script).catch(() => "");
}

async function normalizeChatGptTabs(cdpPort, chatgptUrl) {
  const startedAt = Date.now();
  let targets = [];
  while (Date.now() - startedAt < 10000) {
    targets = await readWindowsCdpTargets(cdpPort);
    if (targets.length > 0) {
      break;
    }
    await sleep(250);
  }

  const plan = planChatGptTabNormalization(targets, chatgptUrl);
  await openWindowsCdpTarget(cdpPort, plan.openUrl);
  await sleep(1000);
  for (const targetId of plan.closeTargetIds) {
    await closeWindowsCdpTarget(cdpPort, targetId);
  }
  await sleep(1000);
}

async function readWindowsCdpRuntimeValue(webSocketDebuggerUrl, expression) {
  const script = `
try {
  $socket = [System.Net.WebSockets.ClientWebSocket]::new()
  $connected = $socket.ConnectAsync([Uri]${powerShellString(webSocketDebuggerUrl)}, [Threading.CancellationToken]::None).Wait(2000)
  if (-not $connected) { ''; exit 0 }

  $payload = @{
    id = 1
    method = 'Runtime.evaluate'
    params = @{
      expression = ${powerShellString(expression)}
      returnByValue = $true
    }
  } | ConvertTo-Json -Compress -Depth 5

  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $sendCompleted = $socket.SendAsync(
    [ArraySegment[byte]]::new($bytes),
    [System.Net.WebSockets.WebSocketMessageType]::Text,
    $true,
    [Threading.CancellationToken]::None
  ).Wait(2000)
  if (-not $sendCompleted) { ''; exit 0 }

  $buffer = New-Object byte[] 65536
  $builder = [Text.StringBuilder]::new()
  do {
    $receiveTask = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None)
    if (-not $receiveTask.Wait(2000)) { break }
    $result = $receiveTask.Result
    if ($result.Count -gt 0) {
      [void]$builder.Append([Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count))
    }
  } while ($result -and -not $result.EndOfMessage)

  try {
    [void]$socket.CloseAsync(
      [System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure,
      'done',
      [Threading.CancellationToken]::None
    ).Wait(1000)
  } catch {}

  $builder.ToString()
} catch {
  ''
}
`;
  const output = await runPowerShell(script).catch(() => "");
  if (!output) {
    return null;
  }

  try {
    const parsed = JSON.parse(output);
    return parsed?.result?.result?.value ?? null;
  } catch {
    return null;
  }
}

async function launchWindowsBrowser(browserPath, args) {
  const argumentList = args.map((arg) => powerShellString(arg)).join(", ");
  const script = `
$browserPath = ${powerShellString(browserPath)}
Start-Process -FilePath $browserPath -ArgumentList @(${argumentList})
`;
  await runPowerShell(script);
}

async function syncExtension({ sourceDir, installDir }) {
  await mkdir(path.dirname(installDir), { recursive: true });
  await rm(installDir, { recursive: true, force: true });
  await cp(sourceDir, installDir, { recursive: true });
}

async function readWorkers(config) {
  const payload = await readJson(`${relayBaseUrl(config)}/extension/workers`);
  return Array.isArray(payload.workers) ? payload.workers : [];
}

export async function extensionDoctorReport(config, options = {}) {
  const defaults = relayExtensionDefaults(config);
  const profileDir = options.profileDir ?? defaults.profileDir;
  const extensionInstallDir = options.extensionInstallDir ?? defaults.extensionInstallDir;
  const cdpPort = options.cdpPort ?? defaults.cdpPort;
  const browserPath = options.browserPath ?? extensionBrowserPath(config, defaults.browser);
  const browserPathForWindows = await maybeWindowsPath(browserPath);
  const executableName = windowsExecutableName(browserPathForWindows);
  const profileDirForChrome = await maybeWindowsPath(profileDir);
  const extensionDirForChrome = await maybeWindowsPath(extensionInstallDir);

  let workers = [];
  let serverReachable = false;
  try {
    workers = await readWorkers(config);
    serverReachable = true;
  } catch {
    serverReachable = false;
  }

  const [chromeRunning, extensionPathExists, targets] = await Promise.all([
    isWindowsBrowserProfileRunning(executableName, profileDirForChrome),
    pathExists(extensionInstallDir),
    readWindowsCdpTargets(cdpPort),
  ]);
  const chatgptTabFound = targets.some((target) => String(target.url ?? "").startsWith(config.chatgptUrl));
  const chatgptTargets = targets.filter((target) => String(target.url ?? "").startsWith(config.chatgptUrl));
  const contentScriptProbeResults = await Promise.all(
    chatgptTargets
      .map((target) => target.webSocketDebuggerUrl)
      .filter(Boolean)
      .map((webSocketDebuggerUrl) =>
        readWindowsCdpRuntimeValue(
          webSocketDebuggerUrl,
          "Boolean(window.__chatgptWebRelayContentLoaded)",
        ),
      ),
  );
  const contentScriptLoadedFromPage = contentScriptProbeResults.includes(true)
    ? true
    : contentScriptProbeResults.includes(false)
      ? false
      : null;
  const activeWorkerCount = workers.filter((worker) => worker.status !== "stale").length;
  const contentScriptLoaded =
    activeWorkerCount > 0 || contentScriptLoadedFromPage === true;
  const report = {
    status: null,
    serverReachable,
    chromeRunning,
    extensionPathExists,
    chatgptTabFound,
    contentScriptLoaded,
    contentScriptLoadedFromPage,
    contentScriptProbeResults,
    workers,
    browser: defaults.browser,
    profileName: defaults.profileName,
    profileDir,
    extensionInstallDir,
    cdpPort,
    targetCount: targets.length,
  };
  report.status = classifyExtensionDoctorStatus(report);
  return report;
}

export async function launchRelayExtension(config, options = {}) {
  const defaults = relayExtensionDefaults(config);
  const profileDir = options.profileDir ?? defaults.profileDir;
  const extensionSourceDir = options.extensionSourceDir ?? defaults.extensionSourceDir;
  const extensionInstallDir = options.extensionInstallDir ?? defaults.extensionInstallDir;
  const cdpPort = options.cdpPort ?? defaults.cdpPort;
  const browserPath = options.browserPath ?? extensionBrowserPath(config, defaults.browser);
  const workerTimeoutMs = options.workerTimeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;

  const profileDirForChrome = await maybeWindowsPath(profileDir);
  const extensionDirForChrome = await maybeWindowsPath(extensionInstallDir);
  const browserPathForWindows = await maybeWindowsPath(browserPath);
  const executableName = windowsExecutableName(browserPathForWindows);

  await stopWindowsBrowserProfile(executableName, profileDirForChrome);
  await syncExtension({ sourceDir: extensionSourceDir, installDir: extensionInstallDir });

  const args = buildChromeExtensionLaunchArgs({
    cdpPort,
    profileDir: profileDirForChrome,
    extensionDir: extensionDirForChrome,
    chatgptUrl: config.chatgptUrl,
  });
  await launchWindowsBrowser(browserPathForWindows, args);
  await normalizeChatGptTabs(cdpPort, config.chatgptUrl);

  const startedAt = Date.now();
  let report;
  while (Date.now() - startedAt < workerTimeoutMs) {
    report = await extensionDoctorReport(config, { profileDir, extensionInstallDir, cdpPort });
    if (
      report.status === "worker_ready" ||
      report.status === "chatgpt_logged_out" ||
      report.status === "chatgpt_verification_required"
    ) {
      return { ...report, launchArgs: args };
    }
    await sleep(1000);
  }

  return {
    ...(report ?? (await extensionDoctorReport(config, { profileDir, extensionInstallDir, cdpPort }))),
    launchArgs: args,
  };
}
