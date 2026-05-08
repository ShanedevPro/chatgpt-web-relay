---
name: chatgpt-web-relay
description: "Use when the user wants to generate images, run Deep Research reports, or send prompts through a real logged-in ChatGPT web page using the local ChatGPT Web Relay."
---

# ChatGPT Web Relay

Use this skill to give the agent ChatGPT web-page capabilities through the local ChatGPT Web Relay.

Before each relay task, make a cheap readiness check. Reuse an existing repo, installed dependencies, running relay server, browser profile, and logged-in session when they are healthy. Only clone, install, start, or ask for login when needed.

Typical user requests:

- "Use chatgpt-web-relay to generate an image of ..."
- "Use chatgpt-web-relay to run a Deep Research report about ..."
- "Use chatgpt-web-relay to ask ChatGPT ..."

## Rules

- Keep the relay local on `127.0.0.1`.
- Never ask for, inject, print, store, or inspect ChatGPT cookies, auth tokens, session tokens, passwords, or API keys.
- Login happens only in the real browser window opened by the relay launcher.
- If ChatGPT asks for login or human verification, pause and ask the user to complete it in the browser.
- One browser profile should map to one ChatGPT account.

## Bootstrap First

If the current directory is the `chatgpt-web-relay` repo, use it.

Otherwise use `CHATGPT_WEB_RELAY_HOME` when set. If it is unset, use `~/chatgpt-web-relay`. If the repo directory does not exist, clone it:

```bash
RELAY_HOME="${CHATGPT_WEB_RELAY_HOME:-$HOME/chatgpt-web-relay}"
if [ ! -d "$RELAY_HOME/.git" ]; then
  git clone https://github.com/ShanedevPro/chatgpt-web-relay.git "$RELAY_HOME"
fi
cd "$RELAY_HOME"
```

Run all relay commands from that repo directory.

## Prepare The Relay

Only run the setup step that is missing. Do not reinstall dependencies, restart the relay, or ask the user to log in when the existing repo, server, browser profile, and session are already healthy.

Check prerequisites:

```bash
node --version
npm --version
```

Node.js must be version 22 or newer.

Install dependencies when `node_modules` is missing:

```bash
npm ci
```

If `npm ci` fails because the lockfile is absent or stale, run:

```bash
npm install
```

Start or refresh the relay when it is not already healthy:

```bash
npm run relay:start -- --port 8787
```

Check readiness:

```bash
npm run relay:doctor -- --port 8787
```

Healthy status is `worker_ready`.

If status is `chatgpt_logged_out`, tell the user to log in in the opened browser window.

If status is `chatgpt_verification_required`, tell the user to complete the visible human verification.

If status is `extension_not_loaded` or `extension_outdated`, rerun `npm run relay:start -- --port 8787`.

## Map User Intent To Job Mode

- Image generation, create image, picture, icon, poster, illustration: use `create_image`.
- Deep Research, research report, report with sources, sourced report: use `deep_research`.
- Normal ChatGPT prompt, answer, rewrite, summarize, brainstorm: use `normal`.

Default to a fresh ChatGPT conversation for each job. Use `--conversation current` only when the user asks to continue the current thread.

## Execute The User Request

For normal ChatGPT prompts:

```bash
npm run relay:prompt -- "Reply with exactly: relay smoke ok"
```

For Deep Research reports:

```bash
npm run relay:prompt -- --deep "Use Deep Research to briefly explain what a software smoke test is."
```

For image generation:

```bash
npm run relay:prompt -- --image "Create a simple blue robot icon on a white background."
```

For app integrations, use HTTP jobs:

```bash
curl -sS -X POST http://127.0.0.1:8787/jobs \
  -H 'content-type: application/json' \
  -d '{"prompt":"Your prompt","mode":"create_image","conversation":"new"}'
```

Poll:

```bash
curl -sS http://127.0.0.1:8787/jobs/<job-id>
```

Fetch structured output:

```bash
curl -sS http://127.0.0.1:8787/jobs/<job-id>/result.json
```

Return useful results to the user:

- For images, report saved image paths from `images`.
- For Deep Research, summarize `report` and include `sources` when present.
- For normal prompts, return the plain answer from `report`.

## Verify

Before claiming the relay package is ready:

```bash
find src test extension -name '*.js' -print0 | xargs -0 -n1 node --check
npm test
```

For release readiness, also confirm the repository does not contain `.local`, `node_modules`, browser profiles, logs, results, or real secrets.
