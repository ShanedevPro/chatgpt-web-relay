# Windows And WSL Setup

This project is easiest to run from WSL while controlling Windows Edge or Chrome.

## Recommended Setup

1. Install Node.js 22 or newer in WSL.
2. Install Microsoft Edge or Google Chrome on Windows.
3. Install dependencies:

```bash
npm install
```

4. Start the relay:

```bash
npm run relay:start -- --port 8787
```

5. Log in to ChatGPT in the opened browser window if needed.
6. Confirm readiness:

```bash
npm run relay:doctor -- --port 8787
```

## Profiles

Use one profile per ChatGPT account:

```bash
npm run relay:start -- --profile account-a
npm run relay:start -- --profile account-b
```

Profiles live under:

```text
%LOCALAPPDATA%\chatgpt-web-relay\browser-profiles
```

Do not point the relay at your everyday personal browser profile.

## Browser Choice

Edge is the default because it is usually installed on Windows:

```bash
npm run relay:start -- --browser edge
```

Chrome is also supported:

```bash
npm run relay:start -- --browser chrome
```

The launcher automatically searches common Edge and Chrome install locations. You do not need Chrome policy or a packed CRX for local development.

If your browser is installed somewhere unusual, set one of these environment variables before starting:

```bash
export CHATGPT_RELAY_WINDOWS_EDGE="/mnt/c/Path/To/msedge.exe"
export CHATGPT_RELAY_WINDOWS_CHROME="/mnt/c/Path/To/chrome.exe"
```

## Desktop Shortcut

Create a desktop shortcut:

```bash
npm run relay:shortcut
```

The shortcut opens the relay with the default browser, profile, and port.
