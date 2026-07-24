# Contributing

Renderprove is intentionally small. Contributions should preserve a narrow project-inspection contract rather than adding another pipeline language.

## Development

```bash
npm install
npm run ci
npx playwright install chromium
npm run test:browser
```

## Pull requests

- Add tests for manifest, process, receipt, and policy changes.
- Keep project commands shell-free.
- Keep artifact paths beneath the declared output directory.
- Document receipt-contract changes.
- Explain new browser privileges or network access.
- Avoid framework-specific behavior in the core receipt model.
