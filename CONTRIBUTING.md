# Contributing

ChatGPT Web Relay is a local-first developer preview.

## Before Opening A Pull Request

- Run `find src test extension -name '*.js' -print0 | xargs -0 -n1 node --check`.
- Run `npm test`.
- Do not commit `.local`, browser profiles, logs, generated results, screenshots, or account data.
- Do not add token, cookie, session injection, or verification-bypass flows.

## Development Notes

- Keep the relay server local-only by default.
- Use one dedicated browser profile per ChatGPT account.
- Treat ChatGPT UI selectors as fragile and cover selector changes with tests.
