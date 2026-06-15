# Outcome Roadmap

Lightfold Grid plans work around outcomes users can demonstrate, not feature count.
The ordering may change as private-alpha evidence reveals more important problems.

## Understand What Every Agent Is Doing

Users can identify each agent's role, current task, communication state, selected
model, routing reason, cost, and failures without reading raw terminal output.

Evidence:

- A new user can explain a running wheel or pipeline topology.
- Delivery failures and recovery actions are understandable without maintainer help.
- Workflow history answers why a model was selected or escalated.

## Complete A Safe First Workflow

Users can install Lightfold Grid, understand that it is not a sandbox, and complete
the demo workflow without maintainer intervention.

Evidence:

- Private-alpha session outcomes meet the thresholds in `PRIVATE_ALPHA.md`.
- Approval prompts make commands, tests, merges, and risk visible before execution.
- Supported-platform packaging and native dependencies pass hosted validation.

## Spend Strong-Model Tokens Only Where They Matter

Users can assign local and cloud models by task, constrain routing, set budgets, and
measure whether mixed-model teams preserve validated outcomes at lower estimated cost.

Evidence:

- Pinned live-model comparisons publish configurations and raw outcomes.
- Users can inspect cost, cloud usage, retries, and escalations per workflow.
- Routing recommendations remain advisory and respect user constraints.

## Trust Concurrent Coding Work

Users can delegate a complex coding task to cooperating agents while preserving
isolated work, tests, review, explicit integration approval, and recoverable history.

Evidence:

- Real repositories complete multi-agent workflows without shared-worktree corruption.
- Restarts recover unfinished work without duplicate execution.
- Failures remain attributable and recoverable.

## Extend The Model And CLI Ecosystem

Contributors can add an adapter with a documented contract, deterministic conformance
tests, and clear capability and privacy metadata.

Evidence:

- A first-time contributor can implement an adapter from `ADAPTERS.md`.
- Beginner-friendly and adapter contribution opportunities remain labeled.
- Community adapters do not depend on models reproducing protocol messages exactly.

## Publish A Trustworthy Developer Alpha

Users can obtain an honestly described, verifiable alpha release with clear support,
security, provenance, compatibility, and rollback boundaries.

Evidence:

- Name clearance, hosted CI, signing, and notarization gates are complete.
- Release artifacts include checksums and an SBOM.
- Known limitations and live-model claims match observed evidence.

See `OPEN_SOURCE_PLAN.md` for detailed release gates and `plan.md` for completed
engineering milestones.
