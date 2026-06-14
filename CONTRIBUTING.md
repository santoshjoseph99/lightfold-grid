# Contributing to Lightfold Grid

Thank you for helping build Lightfold Grid. The project welcomes focused bug fixes,
tests, documentation, CLI adapters, and improvements to orchestration reliability.

By participating, you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
Contributions are submitted under the [Apache License 2.0](./LICENSE).

## Before You Start

- Use GitHub Discussions or an issue for design questions and substantial changes.
- Search existing issues before opening a new one.
- Report vulnerabilities privately according to [SECURITY.md](./SECURITY.md).
- Keep changes scoped. Do not combine unrelated refactors with a feature or fix.
- Never include provider credentials, private prompts, user logs, or proprietary code.

## Development Setup

Requirements:

- Node.js 22.12 or newer
- npm
- macOS or Linux
- Git

```bash
npm install
npm test
npm run test:integration
npm run build
```

The live Ollama test is optional:

```bash
npm run test:ollama
```

## Pull Requests

1. Create a focused branch from the default branch.
2. Add or update tests for behavioral changes.
3. Run the deterministic test suite, integration harness, and build.
4. Update documentation when changing commands, configuration, protocols, security
   boundaries, or user-visible behavior.
5. Complete the pull-request template and disclose AI assistance that materially
   produced the contribution.

Maintainers may request smaller changes, additional tests, or security review. A pull
request is not accepted until required checks pass and a maintainer approves it.

## Project Conventions

- Preserve the stable version-1 `[[STARLIGHT-MSG]]` wire marker unless a separately
  versioned migration is approved.
- Preserve compatibility with existing Starlight data unless a documented migration
  is included.
- Treat agent output, repository content, prompts, and CLI output as untrusted input.
- Keep destructive actions and local command execution visible and user-controlled.
- Use `lightfold-message` rather than manually producing protocol JSON.

## Certificates of Origin

By submitting a contribution, you represent that you have the right to submit it under
the project's license and that it does not contain material you are not authorized to
publish.
