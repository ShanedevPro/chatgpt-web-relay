# Privacy

ChatGPT Web Relay stores runtime data locally.

## What It Stores

- Job records under `.local/jobs`.
- Result Markdown and generated images under `.local/results`.
- Simple logs under `.local/logs`.
- Browser login state in the dedicated Chrome or Edge profile managed by your browser.

## What It Does Not Store By Design

- ChatGPT passwords.
- ChatGPT auth tokens.
- ChatGPT cookies.
- API keys.

The relay redacts common token-like fields from extension events before persisting evidence.

## Operator Responsibility

Prompts and results can contain sensitive user data. Treat `.local` and browser profiles as private local data and do not publish them.
