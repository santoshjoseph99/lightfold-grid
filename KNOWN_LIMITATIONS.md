# Known Limitations

Lightfold Grid is an experimental developer alpha. It is useful for controlled
experimentation with trusted repositories, prompts, CLIs, and models, but it is not a
sandbox or a production operations platform.

## Security And Isolation

- Agent CLIs, approved commands, repository scripts, and tests run with the current
  user's filesystem, network, and credential access.
- Prompt injection and compromised CLIs can still cause unsafe behavior.
- Approval gates reduce accidental execution risk but do not make approved commands safe.
- Diagnostic redaction covers common credential patterns but cannot guarantee removal
  of every secret or proprietary value.

## Models And Providers

- Direct CLI and custom adapters depend on the selected agent following the versioned
  protocol. The bundled Ollama adapter owns lifecycle and correlated results.
- Provider pricing, model capability, privacy, context-window, and latency metadata are
  user configured and may become inaccurate.
- Cost budgets reserve estimates, not guaranteed provider charges.
- Historical recommendations learn from completion criteria, which may be too weak to
  represent actual output quality.
- The committed benchmark is deterministic reference evidence, not a live-model
  performance claim.

## Platforms And Releases

- Manual and local alpha packages may be unsigned. Tagged releases are credential-ready,
  but notarization and trusted-publisher status remain unproven until real certificates
  are configured and a hosted tagged release succeeds.
- Windows support is experimental. WSL discovery and command translation are not included.
- Native dependency compatibility is smoke-tested in CI, but not every shell, CLI,
  repository, architecture, or operating-system release is covered.
- Schema migrations are forward-only; rollback requires restoring a matching backup.

## Workflow Behavior

- Fixed-owner workflow tasks are explicit assignments and are not constrained by
  automatic workflow routing budgets.
- Live provider behavior is nondeterministic and may differ from deterministic integration tests.
- Concurrent coding safety depends on Git worktrees, declared file ownership, tests,
  and human review. It cannot prove semantic correctness.
- The application currently requires Electron's preload bridge and is not a standalone
  browser application.

Review [SECURITY.md](./SECURITY.md), [RELEASES.md](./RELEASES.md), and
[WINDOWS.md](./WINDOWS.md) before installing or running repository work.
