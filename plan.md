# Lightfold Grid Reliability and Orchestration Plan

## Objective

Evolve Lightfold Grid from a prompt-driven PTY message router into a reliable multi-agent
orchestrator capable of coordinating complex coding tasks.

The finished system must distinguish message delivery from task completion, recover
from failures, preserve workflow state, prevent conflicting edits, and verify the
entire Electron-to-agent communication loop.

## Guiding Principles

- The broker owns message identity, routing, delivery, retries, and durable status.
- Agents report task outcomes; writing text to a PTY never means a task completed.
- Every task and response is correlated with stable identifiers.
- Agent lifecycle and readiness are explicit states.
- Complex work is represented as a dependency graph, not only as prompts.
- Concurrent coding agents work in isolated Git worktrees.
- Core orchestration logic remains independent from React, Electron, and PTYs so it
  can be tested deterministically.

## Target Protocol

Replace command-only envelopes with a versioned protocol:

```ts
interface AgentMessage {
  protocolVersion: 1;
  messageId: string;
  taskId: string;
  parentTaskId?: string;
  correlationId?: string;
  from: string;
  to: string;
  kind: "request" | "ack" | "progress" | "result" | "error" | "cancel" | "ready" | "heartbeat";
  payload: {
    instruction?: string;
    summary?: string;
    artifacts?: string[];
    data?: unknown;
  };
  attempt: number;
  timestamp: number;
}
```

Legacy `{ from, to, command, type }` envelopes should remain supported during a
temporary migration period.

## Milestone 1: Reliable Message Protocol

### Tasks

- [x] Add protocol types and runtime validation in `src/services/brokerCore.ts`.
- [x] Assign broker-generated `messageId`, `taskId`, timestamps, and attempt counts.
- [x] Add message kinds: `request`, `ack`, `progress`, `result`, `error`, and `cancel`.
- [x] Preserve the physical PTY pane as the authoritative sender identity.
- [x] Reject malformed, unsupported-version, and unauthorized messages with explicit
      broker errors.
- [x] Add legacy-envelope normalization into the new protocol.
- [x] Replace mutable message objects with immutable status updates.
- [x] Add bounded message-history retention to prevent unbounded renderer memory use.

### Acceptance Criteria

- Every accepted message has stable message and task identifiers.
- Requests can be correlated with acknowledgements, progress, results, and errors.
- Invalid envelopes cannot crash or stall the broker.
- Existing legacy prompts continue to route during migration.

### Tests

- Unit tests for validation and legacy normalization.
- Parser tests for malformed JSON, unsupported versions, missing fields, ANSI output,
  chunk boundaries, terminal redraws, and duplicate envelopes.
- Tests proving a pane cannot impersonate another sender.

## Milestone 2: Delivery Acknowledgements, Timeouts, and Retries

### Tasks

- [x] Track separate message states:
      `queued`, `delivering`, `delivered`, `acknowledged`, `completed`, `failed`.
- [x] Treat successful PTY writes as `delivered`, never `completed`.
- [x] Require agents to send an `ack` after accepting a request.
- [x] Add configurable acknowledgement and task-completion timeouts.
- [x] Retry unacknowledged requests with exponential backoff and a maximum attempt
      count.
- [x] Deduplicate requests by `messageId` so retries do not execute work twice.
- [x] Add dead-letter storage for permanently failed messages.
- [x] Expose retry, cancel, and reassign controls in the broker UI.

### Acceptance Criteria

- The broker can distinguish delivery from agent acceptance and task completion.
- A missing acknowledgement triggers bounded retries.
- Duplicate deliveries do not produce duplicate task execution.
- Failed messages remain inspectable and can be manually retried.

### Tests

- Fake-agent tests covering successful acknowledgement, delayed acknowledgement,
  retry, duplicate acknowledgement, permanent failure, and cancellation.
- Tests verifying retries preserve task identity while incrementing attempts.

## Milestone 3: Agent Lifecycle and Readiness

### Tasks

- [x] Define agent states:
      `stopped`, `starting`, `ready`, `busy`, `unresponsive`, `failed`, `stopping`.
- [x] Automatically spawn every configured agent when a workspace loads.
- [x] Add a startup handshake requiring each agent to emit a `ready` message.
- [x] Queue tasks until their target agent is ready.
- [x] Track one active task per agent unless the agent explicitly supports concurrency.
- [x] Add heartbeat messages and unresponsive-agent detection.
- [x] Support restart and task reassignment after agent failure.
- [x] Stop using fixed startup delays for prompt injection; wait for observable
      readiness instead.
- [x] Display lifecycle state, current task, and last heartbeat in the UI.

### Acceptance Criteria

- Messages cannot be lost because a pane was unopened or an agent was still starting.
- The broker knows whether every configured agent is available and busy.
- An unresponsive agent is detected and its task can be retried or reassigned.

### Tests

- Lifecycle tests for startup, readiness, busy state, crash, restart, and reassignment.
- Integration test that sends a task before startup completes and verifies eventual
  delivery after readiness.

## Milestone 4: Durable Broker and Task State

### Tasks

- [x] Move authoritative broker state out of React module globals.
- [x] Introduce a broker service owned by the Electron main process.
- [x] Persist agents, messages, tasks, attempts, statuses, and events in SQLite.
- [x] Store an append-only event log for auditability and recovery.
- [x] Restore unfinished tasks and pending deliveries after application restart.
- [x] Add schema migrations and protocol-version migrations.
- [x] Add retention and cleanup settings for messages, logs, and completed tasks.
- [x] Keep renderer state as a subscribed projection of main-process broker state.

### Acceptance Criteria

- Restarting Lightfold Grid does not lose task progress or pending messages.
- The renderer can reload without changing broker behavior.
- Every task transition can be reconstructed from the event log.

### Tests

- Persistence tests using a temporary SQLite database.
- Crash/restart tests proving queued and acknowledged tasks recover correctly.
- Migration tests for older workspace configurations.

## Milestone 5: Workflow and Dependency Engine

### Tasks

- [x] Define a durable `Task` model with owner, goal, dependencies, status, attempts,
      artifacts, and completion criteria.
- [x] Add task states:
      `planned`, `blocked`, `ready`, `assigned`, `running`, `reviewing`, `completed`,
      `failed`, `cancelled`.
- [x] Represent complex work as a directed acyclic graph of tasks.
- [x] Schedule tasks only after dependencies complete successfully.
- [x] Add explicit task completion criteria and result validation.
- [x] Support task decomposition by an orchestrator agent, subject to broker validation.
- [x] Support failure policies: retry, reassign, block dependents, or cancel workflow.
- [x] Add workflow-level progress, failure, and completion views.
- [x] Add human approval gates for destructive or release-related tasks.

### Acceptance Criteria

- Lightfold Grid can execute a multi-step workflow without relying on one agent to remember
  every dependency.
- Failed prerequisite tasks block dependent work.
- Workflow completion means all required tasks and validation criteria passed.

### Tests

- Scheduler tests for dependency ordering, parallel independent tasks, blocked tasks,
  failure propagation, cancellation, and retries.
- End-to-end workflow test covering specification, implementation, test, review, and
  final result.

## Milestone 6: Safe Concurrent Coding

### Tasks

- [x] Require the workspace to be a Git repository for coding workflows.
- [x] Create one Git worktree and branch per coding agent or task.
- [x] Record each task's worktree, branch, base commit, and changed files.
- [x] Prevent multiple agents from owning the same file unless explicitly approved.
- [x] Add merge sequencing and conflict detection.
- [x] Run tests before accepting a task branch for integration.
- [x] Add review and approval before merging agent changes.
- [x] Preserve failed worktrees for inspection and provide explicit cleanup controls.

### Acceptance Criteria

- Parallel coding agents cannot silently overwrite each other's changes.
- Conflicts are surfaced as workflow tasks rather than hidden filesystem damage.
- Only reviewed, tested branches are merged into the integration branch.

### Tests

- Worktree creation and cleanup tests.
- Parallel non-conflicting edit test.
- Conflicting edit test that produces a blocked merge task.
- Failed-test branch rejection test.

## Milestone 7: Prompt and Agent Contract Hardening

### Tasks

- [x] Generate protocol instructions from one shared template.
- [x] Remove hard-coded and inconsistent pane IDs from prompt files.
- [x] Inject each agent's real pane ID, role, allowed routes, and capabilities.
- [x] Require agents to acknowledge, report progress, and return structured results.
- [x] Add a small agent-side helper executable for emitting valid protocol envelopes.
- [x] Prefer helper commands over asking models to manually reproduce JSON delimiters.
- [x] Validate requested tools and capabilities before task assignment.
- [x] Add prompt-version tracking to agent and task records.

### Acceptance Criteria

- Prompt files cannot accidentally route messages using stale pane identities.
- Agents can emit valid messages without manually formatting protocol JSON.
- The broker assigns tasks only to agents with matching capabilities.

### Tests

- Prompt-generation snapshot tests.
- Helper executable tests for every message kind.
- Capability-routing tests.

## Milestone 8: Full End-to-End Integration Harness

### Tasks

- [x] Build a deterministic fake-agent CLI that communicates through stdin/stdout.
- [x] Launch Lightfold Grid's Electron main-process broker and real node-pty sessions in tests.
- [x] Create a wheel topology with one hub and at least three spokes.
- [x] Verify startup handshakes, task routing, acknowledgements, results, retries, and
      failure recovery through actual PTYs.
- [x] Add an optional live-Ollama wheel test using `gemma4-32k:latest`.
- [x] Add a complex coding fixture repository for worktree and workflow testing.
- [x] Run deterministic integration tests in CI; keep live model tests opt-in.

### Acceptance Criteria

- A test covers Electron broker to PTY to agent and back to broker.
- A wheel workflow survives delayed agents, malformed output, one agent crash, and one
  retried message.
- A coding fixture completes with isolated edits, tests, review, and merge.

### Tests

- Deterministic fake-agent wheel test required in CI.
- Crash/restart recovery test required in CI.
- Optional `npm run test:ollama` live-model test.
- Complex coding workflow test required before declaring Lightfold Grid production-ready.

## Milestone 9: Observability and Operational Controls

### Tasks

- [x] Add structured logs with workflow, task, message, agent, and attempt IDs.
- [x] Add broker metrics for queue depth, delivery latency, task duration, retries,
      failures, and agent uptime.
- [x] Add task timeline and dependency graph views.
- [x] Add message inspection with correlated request/result chains.
- [x] Add workspace health checks for Git, configured CLIs, models, prompts, and Ollama.
- [x] Add exportable diagnostic bundles with secrets redacted.

### Acceptance Criteria

- A failed workflow can be diagnosed without reading raw terminal logs.
- Operators can identify stuck tasks, unavailable agents, and repeated retries.
- Diagnostic exports do not expose secrets.

## Milestone 10: Experimental Windows Platform Support

### Tasks

- [x] Centralize platform-aware shell discovery, arguments, and command execution.
- [x] Use ConPTY-backed `node-pty` sessions with PowerShell as the Windows default.
- [x] Add Windows-compatible child-process inspection for agent readiness.
- [x] Make coding workflow commands and tests portable across Windows, macOS, and Linux.
- [x] Adapt helper paths, fixtures, and line-ending assumptions for Windows.
- [x] Add a Windows, macOS, and Linux CI matrix.
- [x] Document Windows setup, behavior, and known limitations.

### Acceptance Criteria

- PowerShell 7 or Windows PowerShell starts by default when available.
- Command Prompt and Git Bash can be selected as interactive shells.
- Coding workflow commands execute through the platform command shell.
- The real PTY integration harness passes on hosted Windows CI.
- Windows limitations and support expectations are explicit.

### Tests

- Platform abstraction unit tests.
- Portable coding workflow and worktree tests.
- Real PTY integration harness on Windows, macOS, and Linux CI.

## Milestone 11: Repeatable Alpha Packaging And Release Automation

### Tasks

- [x] Add repeatable macOS, Linux, and Windows package commands.
- [x] Package the renderer, Electron main process, native modules, and agent helpers.
- [x] Correct and test installed-build renderer and helper paths.
- [x] Add a tagged alpha release workflow with matching version-tag validation.
- [x] Publish SHA-256 checksums and an SPDX software bill of materials.
- [x] Document local packaging, installation trust warnings, upgrades, rollback, and data paths.

### Acceptance Criteria

- A clean checkout can create an installable package on each supported operating system.
- Installed builds can load the renderer and invoke the external agent message helper.
- Matching alpha tags create prerelease artifacts only after every platform package succeeds.
- Every published alpha includes checksums and an SPDX software bill of materials.
- Users can locate, back up, upgrade, and restore application data.

### Tests

- Package-manifest and release-workflow contract tests.
- Installed-path resolution tests.
- Local unpacked application smoke test.
- Hosted macOS, Linux, and Windows package workflow.

## Milestone 12: Five-Minute Onboarding And Workspace Presets

### Tasks

- [x] Add role presets for orchestrator, planner, builder, tester, reviewer, and release.
- [x] Add explicit solo, wheel, pipeline, and review-loop topology presets.
- [x] Add one-click in-app local Ollama, mixed local/cloud, Gemini, Copilot, and custom CLI grids.
- [x] Keep preset prompts embedded, routes explicit, and YOLO mode disabled.
- [x] Add a deterministic demo Git repository generator and safe starter task.
- [x] Add loadable local-only and mixed local/cloud workspace profiles.
- [x] Document a five-minute quickstart and readiness/protocol troubleshooting.

### Acceptance Criteria

- A new user can create a demo repository and a local Ollama wheel without hand-editing JSON.
- Applying a preset restarts the current grid with role contracts and explicit routes.
- Presets never enable YOLO mode or execute repository tasks without the existing controls.
- The demo repository starts clean and its baseline test passes.
- Users have a documented path for diagnosing failed readiness handshakes.

### Tests

- Role and topology preset contract tests.
- Demo repository generation and baseline test.
- Loadable workspace safety tests.
- Existing deterministic and live Ollama wheel integration tests.

## Milestone 13: CLI And Provider Adapter Compatibility

### Tasks

- [x] Define a provider adapter registry separately from agent prompt instructions.
- [x] Centralize tested launch templates for Ollama, Gemini, Copilot, and custom CLIs.
- [x] Add an explicit adapter selector while preserving legacy command inference.
- [x] Add a bundled stateful Ollama API adapter that owns lifecycle and correlated results.
- [x] Expose adapter capability, lifecycle, prompt-delivery, and privacy metadata.
- [x] Add a deterministic adapter conformance suite.
- [x] Publish provider compatibility notes and a community adapter guide.

### Acceptance Criteria

- Provider-specific launch behavior no longer depends on substring checks in the workspace UI.
- The bundled Ollama adapter retains contract context and emits ready, heartbeat,
  acknowledgement, result, and error messages independently of model formatting.
- Existing workspace files remain loadable without an explicit adapter ID.
- Community adapters have a documented implementation and test contract.

### Tests

- Adapter registry, inference, capability-discovery, and launch-template tests.
- Bundled Ollama adapter conformance test against a deterministic mock provider.
- Existing broker, preset, integration, build, and packaging tests.

## Milestone 14: Constraint-Aware Model Routing

### Tasks

- [x] Add per-agent model profiles for capability tier, privacy, context, latency, and cost.
- [x] Add opt-in task routing constraints while preserving fixed-owner workflows.
- [x] Select the least expensive eligible model and record every candidate evaluation.
- [x] Add ordered fallback chains that escalate without retrying failed owners.
- [x] Persist routing decisions, escalation history, usage, and assignment timing.
- [x] Track provider-reported prompt and completion tokens when available.
- [x] Display assignment reasons, estimated model cost, savings, and escalations.

### Acceptance Criteria

- Local-only tasks never route to cloud adapters.
- Models that violate capabilities, tools, context, tier, or cost constraints are rejected.
- Routed task failures escalate through configured fallback owners.
- Every routed assignment has an inspectable reason and durable candidate evaluation.
- Ops metrics report estimated cost, savings, escalations, and available token usage.

### Tests

- Deterministic least-cost, constraint-rejection, and fallback-order tests.
- Workflow routing-history and escalation tests.
- Schema migration and routing-decision persistence tests.
- Existing broker, PTY integration, adapter, build, and packaging tests.

## Milestone 15: Historical Model Recommendations

### Tasks

- [x] Derive task-family signatures from coding mode, capabilities, tools, privacy,
      capability tier, and context requirements.
- [x] Learn only from completed routed tasks whose selected model still matches the
      current agent profile.
- [x] Recommend the lowest-cost eligible model with successful matching history.
- [x] Report successful-task count, average cost, average duration, confidence, and
      alternative evidence.
- [x] Keep recommendations advisory so user constraints and explicit owners remain
      authoritative.
- [x] Display advisory recommendations beside workflow tasks.

### Acceptance Criteria

- Failed, ineligible, changed-model, and non-matching historical tasks are excluded.
- Recommendations never weaken current privacy, capability, tool, context, or cost constraints.
- Recommendations survive restart because they are derived from durable workflow history.
- The UI explains the evidence and confidence behind each recommendation.

### Tests

- Deterministic task-family matching and recommendation ranking tests.
- Eligibility, changed-model, failed-task, and self-evidence exclusion tests.
- Existing workflow, persistence, integration, build, and packaging tests.

## Milestone 16: Workflow Cost And Cloud-Usage Budgets

### Tasks

- [x] Add durable workflow limits for total estimated cost, cloud estimated cost, and
      cloud assignment count.
- [x] Reserve budget synchronously for every routed assignment and escalation.
- [x] Constrain model selection using the remaining workflow budget.
- [x] Force local-only routing after the cloud-assignment budget is exhausted.
- [x] Record selected-model privacy for durable cloud-usage accounting.
- [x] Display estimated, cloud, assignment, and provider-reported actual usage.

### Acceptance Criteria

- Parallel routed tasks cannot independently spend the same remaining budget.
- Cloud candidates are rejected after cloud cost or assignment limits are exhausted.
- Budget usage and limits survive application restart.
- Fixed-owner tasks remain explicit user assignments outside automatic routing budgets.
- Budget rejection reasons remain inspectable in routing candidate evaluations.

### Tests

- Deterministic budget accounting and remaining-budget constraint tests.
- Cloud-specific routing rejection and workflow validation tests.
- Schema migration and workflow budget persistence tests.
- Existing workflow, integration, live Ollama, build, and packaging tests.

## Milestone 17: Public Reference Benchmark And Proof Format

### Tasks

- [x] Define a versioned public benchmark schema for tasks, models, configurations,
      outcomes, and success thresholds.
- [x] Cover specification, coding, testing, review, debugging, and repository analysis.
- [x] Compare strong-model-everywhere, mixed-model, and local-only configurations.
- [x] Report completion, validation, cost, latency, retries, escalations, human
      interventions, cloud assignments, and raw per-task outcomes.
- [x] Add a reproducible CLI that writes JSON and Markdown result summaries.
- [x] Document the boundary between deterministic reference evidence and live-model claims.

### Acceptance Criteria

- A clean checkout can reproduce the committed raw result summary.
- Missing assignments or outcomes fail benchmark validation.
- The alpha threshold is explicit and evaluated automatically.
- Results do not misrepresent declared fixture outcomes as live-model performance.

### Tests

- Benchmark schema validation and required-category coverage tests.
- Deterministic scoring, comparison, and threshold tests.
- Existing workflow, integration, live Ollama, build, and packaging tests.

## Milestone 18: Automated Public-Alpha Readiness Gates

### Tasks

- [x] Separate repository-controlled release gates from external legal, credential, and
      real-user blockers.
- [x] Add an Electron-ABI native smoke test for SQLite and real `node-pty` process creation.
- [x] Run native smoke and readiness checks in cross-platform CI and release packaging.
- [x] Add machine-checkable evidence for policies, limitations, approval controls,
      diagnostic redaction, provenance, and benchmark reproducibility.
- [x] Publish dedicated known-limitations, source-provenance, and readiness documents.
- [x] Fail automation when any repository-controlled alpha gate regresses.

### Acceptance Criteria

- `npm run alpha:readiness` passes repository gates and reports external blockers.
- `npm run native:smoke` verifies native modules using the packaged Electron ABI.
- CI and release workflows run both checks on Windows, macOS, and Linux.
- External blockers are never represented as completed by repository automation.

### Tests

- Readiness evaluation, failure, and external-blocker tests.
- Native SQLite and real PTY smoke execution.
- Release workflow contract tests.
- Existing deterministic, integration, live Ollama, build, and packaging tests.

## Milestone 19: Private-Alpha And Community Launch Kit

### Tasks

- [x] Define a repeatable private-alpha session protocol with participant, consent,
      privacy, observation, outcome, and safety guidance.
- [x] Add a structured private-alpha feedback form that does not request sensitive data.
- [x] Publish a roadmap organized around measurable user outcomes.
- [x] Define beginner-friendly, adapter, documentation, feedback, and security labels.
- [x] Add a structured adapter contribution and conformance proposal form.
- [x] Add a machine-checkable community-readiness gate to cross-platform CI and
      release packaging.
- [x] Keep recruitment, observed sessions, and public-repository launch explicitly
      external and incomplete.

### Acceptance Criteria

- `npm run community:readiness` passes repository gates and reports external blockers.
- Private-alpha sessions have a consistent script, evidence record, and stop conditions.
- Contributors can identify scoped beginner and adapter opportunities.
- The roadmap explains intended user outcomes and evidence rather than feature count.
- Repository automation never claims that participants were recruited or observed.

### Tests

- Community-readiness evaluation, regression, and external-blocker tests.
- Existing readiness, deterministic, integration, live Ollama, build, and packaging tests.

## Milestone 20: Pinned Live-Model Benchmark Evidence Pipeline

### Tasks

- [x] Define a versioned campaign contract for pinned repositories, prompt artifacts,
      models, pricing, configurations, repetitions, and raw evidence.
- [x] Require at least three complete repetitions of every configuration/task pair.
- [x] Validate configuration assignments, timestamps, metrics, safe evidence paths,
      unique evidence records, and SHA-256 bundle integrity.
- [x] Aggregate repeated outcomes into completion, validation, cost, latency, retry,
      escalation, intervention, and cloud-assignment comparisons.
- [x] Keep fixture campaigns visibly distinct from publishable live evidence.
- [x] Add a publishable-live validation CLI and a fixture contract check to CI and
      release packaging.
- [x] Preserve actual repeated live-model comparisons as external evidence.

### Acceptance Criteria

- `npm run benchmark:live:contract` validates the committed fixture without making
  model-performance claims.
- `npm run benchmark:live:validate -- path/to/campaign.json` rejects fixture provenance
  and incomplete, unpinned, mismatched, unsafe, or tampered evidence.
- Every summarized live result is traceable to a unique raw evidence record.
- Repository readiness passes while the actual live-comparison external blocker remains.

### Tests

- Campaign completeness, provenance, assignment, raw-evidence, and aggregation tests.
- Existing benchmark, readiness, deterministic, integration, live Ollama, build, and
  packaging tests.

## Milestone 21: Application Identity And Credential-Ready Signing

### Tasks

- [x] Add project-authored SVG, PNG, and ICNS application identity assets.
- [x] Configure platform packages to use Lightfold Grid icons.
- [x] Add macOS hardened-runtime entitlements and a credential-aware notarization hook.
- [x] Allow unsigned local and manual packages while requiring credentials for tagged
      macOS and Windows releases.
- [x] Add a signing-readiness audit that separates repository preparation from external
      certificate blockers.
- [x] Document required secrets, rotation, unsigned-build boundaries, and verification.
- [x] Keep actual signature, notarization, and trusted-publisher evidence external.

### Acceptance Criteria

- Packaged apps use project-authored Lightfold Grid identity instead of Electron defaults.
- `npm run release:signing-readiness` passes repository gates and reports credential blockers.
- Credential-required mode fails when a tagged platform lacks required secrets.
- Tagged macOS packaging is hardened and invokes notarization when credentials exist.
- Manual and local packaging remain available without maintainer credentials.

### Tests

- Signing-readiness repository, credential, and failure tests.
- Packaging identity and tagged-release workflow contract tests.
- Existing readiness, deterministic, integration, live Ollama, build, and packaging tests.

## Milestone 22: GitHub Repository Bootstrap

### Tasks

- [x] Document the first GitHub repository creation and push path.
- [x] Inventory existing GitHub Actions, issue forms, labels, PR template, and Dependabot setup.
- [x] Document recommended repository settings, branch protection, vulnerability reporting,
      labels, and hosted workflow checks.
- [x] Document release signing secrets without requiring placeholder credentials.
- [x] Add a GitHub bootstrap readiness audit that separates repository files from external
      GitHub setup.
- [x] Keep remote creation, first push, hosted workflow validation, and public launch as
      external actions.

### Acceptance Criteria

- `npm run github:readiness` passes repository gates and reports missing GitHub setup.
- The repository has CI, release, security, dependency, and secret-scanning workflows.
- First-push, branch-protection, Actions, labels, vulnerability reporting, and signing
  secret setup are documented.
- Automation does not claim that the repository has been pushed or hosted CI has run.

### Tests

- GitHub bootstrap readiness, origin detection, and regression tests.
- Existing readiness, deterministic, integration, live Ollama, build, and packaging tests.

## Milestone 23: Hosted GitHub Validation Evidence

### Tasks

- [x] Define a hosted GitHub Actions evidence schema for workflow runs and jobs.
- [x] Validate exact repository, branch, commit, workflow status, and job conclusions.
- [x] Require successful hosted CI jobs for Ubuntu, macOS, and Windows.
- [x] Require successful CodeQL and secret-scan runs for the same commit.
- [x] Add a GitHub CLI collector for real hosted run evidence.
- [x] Add a deterministic fixture contract to CI while keeping real hosted run URLs external.
- [x] Document how and when hosted validation may be marked complete.

### Acceptance Criteria

- `npm run hosted:validation` validates the committed fixture evidence contract.
- `npm run hosted:validation -- hosted-validation/latest.json` can validate real collected evidence.
- Pending, failed, incomplete, wrong-commit, or missing-platform evidence is rejected.
- Public-alpha readiness still treats actual hosted validation as external until real
  run URLs are collected for the pushed commit.

### Tests

- Hosted validation success, missing-platform, pending-run, and wrong-commit tests.
- Existing readiness, deterministic, integration, live Ollama, build, and packaging tests.

## Recommended Implementation Order

1. Reliable message protocol.
2. Acknowledgements, timeouts, retries, and deduplication.
3. Agent lifecycle and readiness.
4. Durable main-process broker state.
5. Workflow and dependency engine.
6. Safe concurrent coding with Git worktrees.
7. Prompt and agent contract hardening.
8. Full end-to-end integration harness.
9. Observability and operational controls.
10. Experimental Windows platform support.
11. Repeatable alpha packaging and release automation.
12. Five-minute onboarding and workspace presets.
13. CLI and provider adapter compatibility.
14. Constraint-aware model routing.
15. Historical model recommendations.
16. Workflow cost and cloud-usage budgets.
17. Public reference benchmark and proof format.
18. Automated public-alpha readiness gates.
19. Private-alpha and community launch kit.
20. Pinned live-model benchmark evidence pipeline.
21. Application identity and credential-ready signing.
22. GitHub repository bootstrap.
23. Hosted GitHub validation evidence.

## Definition of Production-Ready for Complex Coding Tasks

Lightfold Grid is ready for complex coding tasks when all of the following are true:

- [x] Every configured agent automatically starts and reports readiness.
- [x] Requests are acknowledged, correlated, retried, and deduplicated.
- [x] Task completion is based on structured results and validation criteria.
- [x] Workflow dependencies and failures are managed by a durable scheduler.
- [x] Restarting Lightfold Grid restores unfinished workflows.
- [x] Concurrent coding agents use isolated Git worktrees.
- [x] Integration requires passing tests and review.
- [x] The full Electron-to-PTY-to-agent loop is covered by deterministic CI tests.
- [x] A complex fixture workflow completes successfully despite a delayed agent, a
      malformed message, a retry, and an agent restart.
