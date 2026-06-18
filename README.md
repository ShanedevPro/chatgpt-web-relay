# ChatGPT Web Relay

[English](README.md) | [中文](README.zh-CN.md)

Local-only relay for sending jobs to the real ChatGPT website through a browser extension and a dedicated Chrome or Edge profile.

```text
Your app -> local relay server -> browser extension -> real ChatGPT page -> local relay server -> Your app
```

This project does not inject cookies, session tokens, or auth tokens. You log in normally in the opened browser profile, and that profile keeps the login until ChatGPT expires it.

## Quick Start

Requirements:

- Node.js 22 or newer.
- Windows Edge or Google Chrome.
- A ChatGPT account that can use the feature you request.
- WSL is supported and is the main tested setup.

Install:

```bash
git clone https://github.com/ShanedevPro/chatgpt-web-relay.git
cd chatgpt-web-relay
npm ci
```

If the lockfile is not available in your fork, use `npm install`.

Start the relay:

```bash
npm run relay:start -- --port 8787
```

This starts the local server, finds Edge or Chrome, copies and loads the unpacked extension, opens a dedicated browser profile, and navigates to `https://chatgpt.com/`.

If ChatGPT is logged out, log in in the opened browser window. Keep the ChatGPT tab open.

Check status:

```bash
npm run relay:doctor -- --port 8787
```

What success looks like:

```text
worker_ready
```

Run a smoke test:

```bash
npm run relay:prompt -- "Reply with exactly: relay smoke ok"
```

## Common Tasks

Normal chat:

```bash
npm run relay:prompt -- "Reply with exactly: relay smoke ok"
```

Deep Research:

```bash
npm run relay:prompt -- --deep "Use Deep Research to briefly explain what a software smoke test is."
```

Deep Research requires the real ChatGPT `+` menu to show `Deep research`. `Web search` is a different tool and is not treated as Deep Research.

Create Image:

```bash
npm run relay:prompt -- --image "Create a simple blue robot icon on a white background."
```

Continue the currently open ChatGPT conversation instead of starting a new one:

```bash
npm run relay:prompt -- --conversation current "Continue the previous answer."
```

## Install As An Agent Skill

Install the bundled skill if you want an AI agent to use this relay as a capability for image generation, Deep Research reports, and normal ChatGPT web prompts:

- [ChatGPT Web Relay Skill](skills/chatgpt-web-relay/SKILL.md)

Ask your agent:

```text
Install the skill from https://github.com/ShanedevPro/chatgpt-web-relay/tree/main/skills/chatgpt-web-relay
```

Restart the agent, then ask:

```text
Use chatgpt-web-relay to generate an image of a blue robot icon.
Use chatgpt-web-relay to run a Deep Research report about smoke testing.
Use chatgpt-web-relay to ask ChatGPT to summarize this text.
```

The skill will clone this repo when needed, install dependencies, start the local relay, ask you to log in if required, submit the job, and return saved results.

## Use From Another App

For another product, UI, or agent, the flow is:

1. Start the relay.
2. Keep one logged-in ChatGPT tab open with the extension loaded.
3. Create a job.
4. Poll until the job completes.
5. Read plain text or structured JSON.

Create a job:

```bash
curl -sS -X POST http://127.0.0.1:8787/jobs \
  -H 'content-type: application/json' \
  -d '{"prompt":"Reply with exactly: hello from relay","mode":"normal"}'
```

Poll:

```bash
curl -sS http://127.0.0.1:8787/jobs/<job-id>
```

Fetch text:

```bash
curl -sS http://127.0.0.1:8787/jobs/<job-id>/result
```

Fetch structured JSON with report text, sources, and image metadata when available:

```bash
curl -sS http://127.0.0.1:8787/jobs/<job-id>/result.json
```

More integration docs:

- [Consumer Integration Guide](docs/consumer-integration-guide.md)
- [Windows And WSL Setup](docs/setup-windows.md)
- [Troubleshooting](docs/troubleshooting.md)

## Why This Exists

Sometimes a product, local tool, or coding agent needs a ChatGPT web feature such as Deep Research or Create Image, but the usual options are awkward:

- Manual web use is reliable, but slow. Someone has to open ChatGPT, paste a prompt, wait, download or copy the result, and move it back.
- Built-in agent features can be convenient, but they are tied to a specific agent app, account setup, or official integration. They may not work for another local UI, another coding agent, or a custom API setup.
- Heavy third-party gateway projects can be powerful, but they often solve a much bigger problem than a local developer needs.

ChatGPT Web Relay is the small local option. Your app sends a job to `127.0.0.1`; the browser extension types it into the real ChatGPT page using a dedicated logged-in browser profile; the relay saves the result for your app to read.

It is built for developers who want a simple, local, browser-backed bridge without token injection, cookie copying, account-pool infrastructure, or a hosted gateway.

## 中文文档

完整中文说明请看 [README.zh-CN.md](README.zh-CN.md)。

## Features

- Normal chat jobs.
- Deep Research jobs with report text and captured source evidence when visible.
- Create Image jobs with generated images saved locally.
- Fresh ChatGPT conversation by default for every job.
- Named browser profiles so one profile can map to one ChatGPT account.
- Local HTTP API for other apps and agents.
- Windows/WSL-friendly launcher that finds Edge or Chrome and auto-loads the unpacked extension.
- Optional desktop shortcut helper.

## Browser Path Discovery

`relay:start` and `relay:doctor` automatically look for Edge and Chrome in system and user install locations, including `Program Files`, `Program Files (x86)`, and `%LOCALAPPDATA%`.

If your browser is installed somewhere else, set one of these fallback variables:

```bash
CHATGPT_RELAY_WINDOWS_EDGE="/mnt/c/path/to/msedge.exe"
CHATGPT_RELAY_WINDOWS_CHROME="/mnt/c/path/to/chrome.exe"
```

On native Windows, use normal Windows paths such as `C:\Path\To\chrome.exe`.

## Profiles

Use Edge by default:

```bash
npm run relay:start -- --port 8787
```

Use Chrome instead:

```bash
npm run relay:start -- --browser chrome --port 8787
```

Use a named profile:

```bash
npm run relay:start -- --profile account-a --port 8787
```

Profile names may contain only letters, numbers, hyphens, and underscores. Use one profile per ChatGPT account.

## Troubleshooting

Common `relay:doctor` statuses:

- `browser_not_found`: install Edge/Chrome or set the browser path environment variable.
- `chatgpt_logged_out`: log in in the opened browser window.
- `chatgpt_verification_required`: complete the visible human verification.
- `extension_not_loaded`: restart with `npm run relay:start`.
- `extension_outdated`: close old ChatGPT relay tabs and restart.
- `server_down`: start the relay.

## Desktop Shortcut

On Windows/WSL:

```bash
npm run relay:shortcut
```

This creates a local command file and desktop shortcut that starts the relay with the current default options.

## Runtime Files

Runtime state is ignored by git:

```text
.local/jobs
.local/results
.local/logs
```

Windows browser profiles and the copied extension live under:

```text
%LOCALAPPDATA%\chatgpt-web-relay\
```

Do not commit browser profiles, logs, generated results, screenshots, or account data.

## Environment

Copy `.env.example` if you want to customize paths or defaults:

```bash
cp .env.example .env
```

Useful variables:

- `CHATGPT_RELAY_PORT`
- `CHATGPT_RELAY_PROFILE`
- `CHATGPT_RELAY_EXTENSION_BROWSER`
- `CHATGPT_RELAY_WINDOWS_BROWSER_PROFILES`
- `CHATGPT_RELAY_WINDOWS_EXTENSION_DIR`
- `CHATGPT_RELAY_WINDOWS_EDGE`
- `CHATGPT_RELAY_WINDOWS_CHROME`
- `CHATGPT_RELAY_WINDOWS_LOCALAPPDATA`

## Tests

```bash
npm test
```

The tests are offline and use Node's built-in test runner.

## Roadmap

- Small local status dashboard.
- Optional extended-thinking selector.
- Better multi-profile UI.
- More robust selectors as ChatGPT UI changes.

## Security And Privacy

- This relay is local-first and binds to `127.0.0.1` by default.
- Do not expose it to the public internet.
- Do not send auth tokens, cookies, passwords, or API keys through jobs.
- See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).
