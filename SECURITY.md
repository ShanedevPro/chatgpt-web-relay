# Security Policy

ChatGPT Web Relay is designed for local development and local automation.

## Supported Use

- Bind the relay to `127.0.0.1`.
- Use a dedicated browser profile for each ChatGPT account.
- Log in through the normal ChatGPT browser flow.
- Keep runtime files out of git.

## Do Not Do This

- Do not expose the relay server to the public internet.
- Do not send passwords, cookies, auth tokens, session tokens, or API keys through relay jobs.
- Do not commit `.local`, browser profiles, logs, generated results, screenshots, or account data.
- Do not use this project to bypass login, human verification, or access controls.

## Reporting Issues

Please open a private security advisory or contact the maintainers before publishing details for a vulnerability.
