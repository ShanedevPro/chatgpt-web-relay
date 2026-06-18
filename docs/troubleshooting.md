# Troubleshooting

## `worker_ready`

The relay is healthy. A ChatGPT tab is open, the extension is loaded, and the worker is connected.

## `chatgpt_logged_out`

Open the relay browser window and log in to ChatGPT. The profile should keep the login until ChatGPT expires the session.

## `chatgpt_verification_required`

Complete the visible human verification in the relay browser window. The relay does not bypass verification.

## `extension_not_loaded`

Restart with:

```bash
npm run relay:start -- --port 8787
```

Manual extension loading should not be needed. The launcher uses `--load-extension`.

## `extension_outdated`

Close old ChatGPT tabs from the relay profile and run:

```bash
npm run relay:start -- --port 8787
```

## `server_down`

Start the relay:

```bash
npm run relay:start -- --port 8787
```

## `browser_not_found`

The relay could not find Edge or Chrome in common install locations. Install one of them, or set:

```bash
CHATGPT_RELAY_WINDOWS_EDGE
CHATGPT_RELAY_WINDOWS_CHROME
```

Then run:

```bash
npm run relay:doctor -- --port 8787
```

## Deep Research Does Not Start

Check that your ChatGPT account can use Deep Research in the real website. If the visible UI changes, selector updates may be needed.

Deep Research must appear in the `+` menu next to the prompt box. `Web search` is a separate ChatGPT tool and is not a Deep Research fallback.

## Image Job Fails

Image capture depends on ChatGPT's current image DOM and whether the generated image URL can be fetched by the page. If capture fails, the job fails instead of returning incomplete image metadata.
