# Consumer Integration Guide

This guide is for another app, UI, or local agent that wants to use ChatGPT Web Relay without knowing how the browser extension works.

Simple picture:

```text
Your app -> relay API -> real ChatGPT tab -> relay API -> Your app
```

## Runtime Setup

Start the relay:

```bash
npm run relay:start -- --port 8787
```

Keep the opened ChatGPT tab available. If it asks for login or human verification, complete that in the real browser window.

Check readiness:

```bash
npm run relay:doctor -- --port 8787
```

Expected healthy status:

```text
worker_ready
```

Manual extension loading in `chrome://extensions` should not be needed. The launcher starts the browser with `--load-extension` and a dedicated relay profile.

## API Flow

All modes use the same flow:

1. Create a job with `POST /jobs`.
2. Poll `GET /jobs/:id` until the job is final.
3. Fetch `GET /jobs/:id/result` for plain text or Markdown.
4. Fetch `GET /jobs/:id/result.json` for structured data.

Final statuses:

- `completed`: result is ready.
- `failed`: the relay tried but could not complete the job.
- `needs_user_input`: the browser needs login, verification, or manual attention.

Non-final statuses:

- `pending`: queued.
- `running`: the browser extension is working.

Only one browser job runs at a time in v1.

## Job Fields

`POST /jobs`

```json
{
  "prompt": "Your prompt",
  "mode": "normal",
  "conversation": "new"
}
```

Fields:

- `prompt` is required.
- `mode` can be `normal`, `deep_research`, or `create_image`.
- `conversation` can be `new` or `current`.
- `mode` defaults to `normal`.
- `conversation` defaults to `new`.

Use `conversation: "new"` for independent jobs. Use `conversation: "current"` only when you intentionally want to continue the currently open ChatGPT thread.

## Normal Chat

Create a normal chat job:

```bash
curl -sS -X POST http://127.0.0.1:8787/jobs \
  -H 'content-type: application/json' \
  -d '{"prompt":"Reply with exactly: hello from relay","mode":"normal","conversation":"new"}'
```

You can omit defaults:

```bash
curl -sS -X POST http://127.0.0.1:8787/jobs \
  -H 'content-type: application/json' \
  -d '{"prompt":"Reply with exactly: hello from relay"}'
```

Normal jobs usually return no sources:

```json
{
  "sources": [],
  "sourceCount": 0
}
```

## Deep Research

Create a Deep Research job:

```bash
curl -sS -X POST http://127.0.0.1:8787/jobs \
  -H 'content-type: application/json' \
  -d '{"prompt":"Use Deep Research to briefly explain what a software smoke test is.","mode":"deep_research","conversation":"new"}'
```

Deep Research can take much longer than normal chat. Your UI should show a waiting state while the job is `pending` or `running`.

Fetch report text:

```bash
curl -sS http://127.0.0.1:8787/jobs/<job-id>/result
```

Fetch report and sources:

```bash
curl -sS http://127.0.0.1:8787/jobs/<job-id>/result.json
```

Example:

```json
{
  "id": "job-...",
  "status": "completed",
  "mode": "deep_research",
  "conversation": "new",
  "conversationId": "conversation-...",
  "conversationUrl": "https://chatgpt.com/c/conversation-...",
  "report": "A software smoke test is...",
  "sources": [
    {
      "type": "citation",
      "citationNumber": "1",
      "title": "Smoke Test - ISTQB Glossary",
      "domain": "istqb-glossary.page",
      "snippet": "Smoke Test. A test suite...",
      "link": "https://..."
    }
  ],
  "sourceCount": 55,
  "images": [],
  "imageCount": 0,
  "resultPath": "/absolute/path/.local/results/job-....md",
  "completedAt": "2026-05-08T..."
}
```

If no sources were captured, `sources` is empty and `sourceCount` is `0`.

## Create Image

Create an image job:

```bash
curl -sS -X POST http://127.0.0.1:8787/jobs \
  -H 'content-type: application/json' \
  -d '{"prompt":"Create a simple blue robot icon on a white background.","mode":"create_image","conversation":"new"}'
```

Fetch Markdown summary:

```bash
curl -sS http://127.0.0.1:8787/jobs/<job-id>/result
```

Fetch image metadata:

```bash
curl -sS http://127.0.0.1:8787/jobs/<job-id>/result.json
```

Example:

```json
{
  "id": "job-...",
  "status": "completed",
  "mode": "create_image",
  "conversation": "new",
  "report": "Generated 1 image.\n\n![Generated image 1](/absolute/path/.local/results/job-.../image-1.png)",
  "images": [
    {
      "index": 1,
      "contentType": "image/png",
      "path": "/absolute/path/.local/results/job-.../image-1.png",
      "sourceUrl": "https://...",
      "width": 1024,
      "height": 1024,
      "alt": "generated image"
    }
  ],
  "imageCount": 1
}
```

## JavaScript Client

```js
const RELAY_BASE_URL = "http://127.0.0.1:8787";

async function createRelayJob(prompt, { mode = "normal", conversation = "new" } = {}) {
  const response = await fetch(`${RELAY_BASE_URL}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, mode, conversation }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create job: ${response.status}`);
  }

  return response.json();
}

async function waitForRelayJob(id, { intervalMs = 1500, timeoutMs = 35 * 60 * 1000 } = {}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${RELAY_BASE_URL}/jobs/${id}`);
    const job = await response.json();

    if (job.status === "completed") return job;
    if (job.status === "failed" || job.status === "needs_user_input") {
      throw new Error(`${job.status}: ${job.error || "Relay job did not complete."}`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for relay job: ${id}`);
}

async function fetchRelayResultJson(id) {
  const response = await fetch(`${RELAY_BASE_URL}/jobs/${id}/result.json`);
  if (!response.ok) {
    throw new Error(`Failed to fetch result: ${response.status}`);
  }
  return response.json();
}

export async function askRelay(prompt, options) {
  const created = await createRelayJob(prompt, options);
  await waitForRelayJob(created.id, {
    timeoutMs: options?.mode === "deep_research" ? 35 * 60 * 1000 : 10 * 60 * 1000,
  });
  return fetchRelayResultJson(created.id);
}
```

## Error Handling

Treat `needs_user_input` as a browser state problem, not an API failure. Show a clear operator message:

```text
Open the relay browser and complete login or verification.
```

If a job fails because a ChatGPT UI control cannot be found, restart the relay and check the ChatGPT tab. The ChatGPT website can change its UI, so selectors may need updates over time.
