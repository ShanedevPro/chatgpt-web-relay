#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createConfig } from "./config.js";
import { extensionDoctorReport, launchRelayExtension } from "./extensionLauncher.js";
import { startServer } from "./server.js";

function usage() {
  return `Usage:
  npm run relay:start -- --port 8787
  npm run relay:start -- --browser chrome --profile account-a
  npm run relay:doctor -- --port 8787
  npm run relay:prompt -- "your prompt"
  npm run relay:prompt -- --deep "your research prompt"
  npm run relay:prompt -- --image "your image prompt"
  npm run relay:prompt -- --conversation current "your follow-up prompt"
  npm run relay:shortcut
`;
}

export function parseArgs(args) {
  const options = {};
  const positional = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port") {
      options.port = Number.parseInt(args[index + 1], 10);
      index += 1;
    } else if (arg === "--profile") {
      options.profile = args[index + 1];
      index += 1;
    } else if (arg === "--browser") {
      options.browser = args[index + 1];
      index += 1;
    } else if (arg === "--cdp-port") {
      options.cdpPort = Number.parseInt(args[index + 1], 10);
      index += 1;
    } else if (arg === "--deep") {
      options.mode = "deep_research";
    } else if (arg === "--image") {
      options.mode = "create_image";
    } else if (arg === "--mode") {
      options.mode = args[index + 1];
      index += 1;
    } else if (arg === "--conversation") {
      options.conversation = args[index + 1];
      index += 1;
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = Number.parseInt(args[index + 1], 10);
      index += 1;
    } else {
      positional.push(arg);
    }
  }

  return { options, positional };
}

function configFromOptions(options = {}) {
  return createConfig({
    port: Number.isFinite(options.port) && options.port > 0 ? options.port : undefined,
    extensionProfileName: options.profile,
    extensionBrowser: options.browser,
    extensionCdpPort:
      Number.isFinite(options.cdpPort) && options.cdpPort > 0 ? options.cdpPort : undefined,
  });
}

function relayBaseUrl(config) {
  return `http://127.0.0.1:${config.port}`;
}

async function readJson(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with HTTP ${response.status}`);
  }
  return payload;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with HTTP ${response.status}`);
  }
  return payload;
}

async function extensionServerReachable(config) {
  try {
    await readJson(`${relayBaseUrl(config)}/extension/workers`);
    return true;
  } catch {
    return false;
  }
}

async function runRelayStart(args) {
  const { options } = parseArgs(args);
  const config = configFromOptions(options);
  const serverAlreadyRunning = await extensionServerReachable(config);
  let serverHandle = null;

  if (!serverAlreadyRunning) {
    serverHandle = await startServer({ config, port: config.port });
  }

  const report = await launchRelayExtension(config, {
    cdpPort: Number.isFinite(options.cdpPort) && options.cdpPort > 0 ? options.cdpPort : undefined,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        ...report,
        relayServer: serverAlreadyRunning
          ? "already_running"
          : `started at http://${serverHandle.host}:${serverHandle.port}`,
      },
      null,
      2,
    )}\n`,
  );

  if (report.status === "chatgpt_logged_out") {
    process.stderr.write("ChatGPT login is required in the opened browser window.\n");
  } else if (report.status === "chatgpt_verification_required") {
    process.stderr.write("ChatGPT human verification is required in the opened browser window.\n");
  } else if (report.status !== "worker_ready") {
    process.exitCode = 1;
  }
}

async function runRelayDoctor(args) {
  const { options } = parseArgs(args);
  const report = await extensionDoctorReport(configFromOptions(options));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function pollRelayJob(config, jobId, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const job = await readJson(`${relayBaseUrl(config)}/jobs/${jobId}`);
    if (job.status === "completed") {
      const resultResponse = await fetch(`${relayBaseUrl(config)}/jobs/${jobId}/result`);
      return { job, resultText: await resultResponse.text() };
    }
    if (job.status === "failed" || job.status === "needs_user_input") {
      return { job, resultText: null };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for relay job: ${jobId}`);
}

async function runRelayPrompt(args) {
  const { options, positional } = parseArgs(args);
  const prompt = positional.join(" ").trim();
  if (!prompt) {
    process.stderr.write("Prompt is required.\n\n");
    process.stderr.write(usage());
    process.exitCode = 1;
    return;
  }

  const config = configFromOptions(options);
  const mode = options.mode ?? "normal";
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : mode === "deep_research"
        ? 35 * 60 * 1000
        : mode === "create_image"
          ? 10 * 60 * 1000
          : config.responseTimeoutMs;

  const created = await postJson(`${relayBaseUrl(config)}/jobs`, {
    prompt,
    mode,
    conversation: options.conversation,
  });
  process.stdout.write(`Queued relay job: ${created.id} (${created.mode}, ${created.conversation})\n`);

  const { job, resultText } = await pollRelayJob(config, created.id, timeoutMs);
  if (job.status === "completed") {
    process.stdout.write(`${resultText}\n`);
    process.stdout.write(`\nSaved result: ${job.resultPath}\n`);
    return;
  }

  process.stderr.write(`Job ${job.id} ended with status: ${job.status}\n`);
  if (job.error) {
    process.stderr.write(`${job.error}\n`);
  }
  process.exitCode = 1;
}

function powershellString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
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

async function runRelayShortcut(args) {
  const { options } = parseArgs(args);
  const config = configFromOptions(options);
  const windowsRoot = await maybeWindowsPath(config.rootDir);
  const localAppData =
    process.env.LOCALAPPDATA ??
    (process.platform === "linux"
      ? "C:\\Users\\%USERNAME%\\AppData\\Local"
      : path.join(os.homedir(), "AppData", "Local"));
  const commandDir = `${localAppData}\\chatgpt-web-relay`;
  const commandPath = `${commandDir}\\Start ChatGPT Web Relay.cmd`;
  const shortcutName = "ChatGPT Web Relay.lnk";
  const startArgs = [
    "run",
    "relay:start",
    "--",
    "--port",
    String(config.port),
    "--browser",
    config.extensionBrowser,
    "--profile",
    config.extensionProfileName,
  ];

  if (process.platform === "linux") {
    const script = `
$commandDir = Join-Path $env:LOCALAPPDATA 'chatgpt-web-relay'
$commandPath = Join-Path $commandDir 'Start ChatGPT Web Relay.cmd'
New-Item -ItemType Directory -Force -Path $commandDir | Out-Null
@"
@echo off
pushd "${windowsRoot}"
npm ${startArgs.join(" ")}
pause
"@ | Set-Content -Encoding ASCII -Path $commandPath
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) ${powershellString(shortcutName)}
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $commandPath
$shortcut.WorkingDirectory = ${powershellString(windowsRoot)}
$shortcut.Save()
Write-Output $shortcutPath
Write-Output $commandPath
`;
    const [shortcutPath, launcherPath] = (await runPowerShell(script)).split(/\r?\n/).filter(Boolean);
    process.stdout.write(`Created shortcut: ${shortcutPath}\n`);
    process.stdout.write(`Created launcher: ${launcherPath}\n`);
    return;
  }

  await mkdir(commandDir, { recursive: true });
  await writeFile(
    commandPath,
    `@echo off\r\npushd "${config.rootDir}"\r\nnpm ${startArgs.join(" ")}\r\npause\r\n`,
    "utf8",
  );
  process.stdout.write(`Created launcher: ${commandPath}\n`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === "relay:start") {
    await runRelayStart(args);
    return;
  }

  if (command === "relay:doctor") {
    await runRelayDoctor(args);
    return;
  }

  if (command === "relay:prompt") {
    await runRelayPrompt(args);
    return;
  }

  if (command === "relay:shortcut") {
    await runRelayShortcut(args);
    return;
  }

  process.stderr.write(usage());
  process.exitCode = 1;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
