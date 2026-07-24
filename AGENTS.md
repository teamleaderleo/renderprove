# Agent instructions

- Prefer small auditable contracts over general browser-agent abstractions.
- Keep local process execution shell-free and environment inheritance narrow.
- Treat screenshots, traces, logs, URLs, and browser state as potentially sensitive.
- Add deterministic unit tests before expanding browser behavior.
- Run `npm run ci` and `npm run test:browser` before merging browser changes.
- Review the complete pull-request diff for trust-boundary changes.
