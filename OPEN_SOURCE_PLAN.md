# Open-Source Release Plan

## Product Thesis

The project is a user-controlled desktop workspace for building mixed-model coding
teams. Users assign specialized roles to local or cloud agents, choose how capable and
expensive each model needs to be, and retain visibility into routing, cost, reliability,
worktree isolation, testing, and review.

The central promise is:

> Use the least expensive model that can reliably complete each task, and escalate only
> when the task requires more capability.

Public positioning should use terms such as **model right-sizing**, **intelligence
budgeting**, and **mixed-model coding teams**. "Token minning" is a memorable internal
phrase, but it may be confused with cryptocurrency mining.

## Naming Decision

**Lightfold Grid** is the approved project name. It combines the project's illumination
theme with the visible grid of cooperating agents.

Suggested positioning:

> Lightfold Grid is an open-source desktop control plane for mixed-model coding teams.
> Assign specialized local or cloud agents to tasks, see how they collaborate, and
> spend strong-model tokens only where they matter.

The npm package name `lightfold-grid` was available when checked on June 13, 2026.
Preliminary searches found several unrelated uses of "Lightfold", including a creator
studio, deployment CLI, game, band, and data consultancy. "Lumenary" also had visible
AI and multi-agent software conflicts. The combined **Lightfold Grid** name was chosen
to be more distinctive, but this research is not comprehensive legal clearance.

### Clearance Gate

Before approving a final name:

- [ ] Search USPTO, EUIPO, WIPO, and relevant national trademark databases.
- [x] Search GitHub repositories, organizations, topics, and major package registries.
- [x] Check npm package and organization-scope availability.
- [ ] Check practical domains and social handles.
- [ ] Search app stores and developer-tool directories.
- [x] Check confusingly similar names in AI, developer tooling, and orchestration.
- [x] Record the final decision and evidence in this document.
- [ ] Obtain legal review before treating the name as a protected product brand.

### Compatibility Rules

- New package, workspace, database, diagnostic, branch, and worktree names use
  `lightfold-grid`; the primary helper is `lightfold-message`.
- `starlight-message` remains a deprecated helper alias for at least one release.
- Existing Starlight workspace and broker files remain loadable.
- The `[[STARLIGHT-MSG]]` marker and internal `Starlight*` protocol symbols remain stable
  for version 1; changing them requires a separately versioned protocol migration.
- Existing persisted worktree paths and branches remain valid.

## Release Scope

The first public release should be an **experimental developer alpha**, not a
production-ready claim.

The alpha must prove one narrow workflow:

1. Install the desktop application.
2. Select a Git repository.
3. Configure an orchestrator, builder, tester, and reviewer using local or cloud CLIs.
4. Assign different model strengths to those roles.
5. Execute a coding workflow with worktree isolation, tests, review, and merge.
6. Inspect cost, reliability, and escalation behavior.

## Workstreams

### 1. Project Identity And Governance

- [x] Approve and execute the naming decision.
- [x] Adopt Apache-2.0 unless a legal review recommends another license.
- [ ] Confirm the project has the right to publish every source file and bundled asset.
- [x] Change the initial public version to `0.1.0-alpha.1`.
- [x] Add `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and `GOVERNANCE.md`.
- [x] Add issue templates, a pull-request template, and support boundaries.
- [x] Document maintainer roles, decision-making, and release authority.

### 2. Security And Trust Boundaries

- [x] Document that the application launches arbitrary CLIs and can execute repository
      commands.
- [x] Keep destructive actions, test execution, merges, and the built-in YOLO mode gated by
      explicit user approval.
- [x] Threat-model prompt injection, malicious repositories, compromised agent CLIs,
      unsafe test commands, secret leakage, and diagnostic exports.
- [x] Add automated secret scanning, dependency review, and security reporting.
- [x] Verify diagnostic redaction against realistic provider credentials and CLI output.
- [x] Publish a supported-platform and sandboxing policy.

### 3. Installation And Release Engineering

- [ ] Add repeatable macOS and Linux packaging.
- [ ] Sign and notarize macOS releases.
- [ ] Publish checksums and a software bill of materials for release artifacts.
- [ ] Test native dependencies such as `node-pty` and SQLite on every supported platform.
- [ ] Add release CI for tagged alpha builds.
- [ ] Document upgrade, rollback, data-directory, and schema-migration behavior.
- [x] Add experimental Windows support with platform-aware PTYs, process inspection,
      coding commands, documentation, and CI coverage.

### 4. Five-Minute Onboarding

- [x] Replace the prototype-focused README opening with the product thesis and alpha warning.
- [ ] Add a five-minute local Ollama quickstart that completes one safe workflow.
- [ ] Add a cloud/local mixed-model quickstart.
- [ ] Ship role presets: orchestrator, planner, builder, tester, reviewer, and release.
- [ ] Ship topology presets: solo, wheel, pipeline, and review loop.
- [ ] Ship a demo repository and one-click example workspace configuration.
- [ ] Record a short demo showing task routing, worktrees, tests, review, metrics, and cost.
- [ ] Add troubleshooting for readiness handshakes and protocol compliance.

### 5. CLI And Provider Compatibility

- [ ] Define the supported CLI adapter contract separately from prompt instructions.
- [ ] Add tested launch templates and compatibility notes for each supported CLI.
- [ ] Add adapter processes where possible so reliability does not depend entirely on a
      model reproducing protocol messages.
- [ ] Publish a community adapter guide and conformance test suite.
- [ ] Add capability discovery for models, context windows, tool support, and privacy mode.

### 6. Model Right-Sizing

This workstream turns the project's intended differentiator into a measurable feature.

- [ ] Add per-agent cost, latency, privacy, context-window, and capability metadata.
- [ ] Add per-task constraints such as `local-only`, maximum cost, required tools, and
      minimum capability tier.
- [ ] Add ordered fallback chains such as local-small -> local-large -> cloud-strong.
- [ ] Track prompt tokens, completion tokens, estimated cost, latency, retries, and
      escalations per task and workflow.
- [ ] Recommend model assignments based on previous successful tasks.
- [ ] Allow users to set workflow-level cost and cloud-usage budgets.
- [ ] Show why a task was assigned or escalated to a model.

### 7. Benchmark And Proof

- [ ] Build a public benchmark suite containing specification, coding, testing, review,
      debugging, and repository-analysis tasks.
- [ ] Compare one strong model for every task against mixed-model and local-only teams.
- [ ] Report completion rate, validation pass rate, cost, latency, retries, escalations,
      and human interventions.
- [ ] Publish reproducible benchmark configurations and raw result summaries.
- [ ] Define the alpha success threshold before launch.

Suggested alpha threshold:

- At least ten external users complete the demo workflow.
- At least five users complete a workflow on their own repository.
- Mixed-model workflows reduce estimated model cost without materially lowering the
  validated completion rate.
- No known critical secret-leakage or destructive-command vulnerabilities remain.

### 8. Community Launch

- [ ] Recruit 5-10 private alpha testers who did not build the project.
- [ ] Observe installation and first-workflow sessions.
- [ ] Label beginner-friendly issues and adapter contribution opportunities.
- [ ] Publish a roadmap based on user outcomes rather than feature count.
- [ ] Create the public repository only after license, security policy, and alpha
      installation path are complete.
- [ ] Announce the project with a working demo, benchmark results, and honest limitations.

## Recommended Order

1. Approve the name and positioning.
2. Add license, governance, security, and contribution documents.
3. Package a signed, installable alpha.
4. Build the five-minute onboarding flow and demo repository.
5. Run a private alpha with real users.
6. Add cost telemetry, fallback chains, and model right-sizing.
7. Publish benchmarks and open the repository broadly.

## Public-Release Definition

The repository is ready for a public alpha when:

- [ ] The final name has passed the clearance gate.
- [x] License, security, contribution, governance, and conduct documents exist.
- [ ] A new user can install a packaged build and complete the demo without maintainer help.
- [ ] Supported platforms are explicitly documented and tested in cross-platform CI.
- [ ] Security-sensitive actions require clear approval.
- [ ] Diagnostic exports and logs have passed secret-leakage testing.
- [ ] Model usage, cost, and escalation behavior are visible.
- [ ] Known limitations and experimental status are prominent.
