# Team Visibility Plan

Lightfold Grid should let users see the team working without forcing them to read raw
terminal logs. The visibility layer must be derived from durable broker, workflow,
message, lifecycle, routing, and usage records so it remains trustworthy.

## Product Goal

Show a live mixed-model team at work:

- who is assigned to each role;
- who is ready, busy, blocked, failed, or waiting;
- what each agent is doing now;
- which messages moved between agents;
- where a task is in the workflow;
- why a model was chosen or escalated;
- what changed in a worktree;
- what tests, review, and merge gates remain;
- what the workflow is expected to cost.

This is not a theatrical office simulation. The UI can be friendly, but every visible
state should answer: "What happened, what is happening, and what should I do next?"

## Primary Surface: Team Room

Add a first-class **Team Room** view beside the terminal grid and broker panels.

### Agent Cards

Each configured agent gets a card showing:

- role and pane ID;
- provider adapter, selected model, privacy mode, and capability tier;
- lifecycle state and last heartbeat;
- current task, if any;
- queue depth for tasks/messages targeting that agent;
- last acknowledgement, progress, result, or error;
- estimated cost and token usage for the active workflow.

Agent cards should be clickable. Clicking an agent filters the message flow, timeline,
workflow graph, and terminal focus to that agent.

### Message Flow

Show recent routed messages as an activity stream and optional graph overlay:

- `request`, `ack`, `progress`, `result`, `error`, `cancel`, `ready`, and `heartbeat`;
- source and target agents;
- task ID and correlation chain;
- delivery status, attempts, retries, and timeout risk;
- small summaries from payloads, never full private prompts by default.

Retries and errors should be visually distinct from normal progress. The user should
be able to jump from a message to its raw broker record when debugging.

### Workflow Board

Add a workflow-oriented board with columns:

- Planned
- Blocked
- Ready
- Running
- Reviewing
- Completed
- Failed or Cancelled

Each card represents a workflow task and includes:

- owner agent;
- dependencies;
- approval requirement;
- current routing decision;
- worktree branch/path for coding tasks;
- required artifacts or completion criteria;
- review, test, and merge status.

This board complements the existing dependency graph. The graph explains ordering; the
board explains current operating state.

### Team Timeline

Create a human-readable timeline from durable events:

- agent started, ready, heartbeat missed, failed, restarted;
- task planned, assigned, running, reviewing, completed, failed, blocked;
- message delivered, acknowledged, retried, completed, dead-lettered;
- model selected, rejected, escalated, or constrained by budget;
- worktree created, tested, reviewed, merged, preserved, or conflicted.

Events should support filters by workflow, agent, task, message, and severity.

### Cost And Model Strip

Show model right-sizing at a glance:

- selected model per active task;
- local/cloud badge;
- estimated cost;
- estimated savings versus strongest eligible model;
- budget remaining;
- escalation history;
- provider-reported actual usage when available.

This is the differentiator. Users should be able to point at the screen and understand
why Lightfold Grid used a cheaper local model or escalated to a stronger cloud model.

## Trust Rules

- Derive all state from broker snapshots, workflow records, message records, lifecycle
  records, model-routing decisions, worktree records, and durable events.
- Do not infer task completion from terminal text alone.
- Do not display hidden prompts, full terminal logs, credentials, or diagnostic secrets
  in the default team view.
- If state is stale or missing, show "unknown" or "not reported" instead of pretending.
- Every friendly label should have a path to the raw broker evidence.

## Implementation Phases

### Phase 1: Team Activity Projection

- Add a pure service that converts `BrokerObservabilitySnapshot` into a
  `TeamActivitySnapshot`.
- Include agent summaries, active assignments, message-flow entries, task-board
  columns, model/cost summaries, and timeline entries.
- Add deterministic tests using synthetic broker/workflow/message snapshots.
- Keep this service independent from React and Electron.

### Phase 2: Team Room UI

- Add a Team Room tab or panel in the right-side workspace.
- Render agent cards, workflow board, activity stream, and model/cost strip.
- Add filters for workflow, agent, task, severity, and active-only state.
- Use existing subscriptions from `brokerProtocol` and `ObservabilityPanel`.
- Keep terminal panes as the detailed execution view, not the primary status view.

### Phase 3: Actionable Drilldowns

- Clicking an agent card focuses the terminal and filters activity.
- Clicking a task card opens dependencies, criteria, worktree details, and approval
  state.
- Clicking a message opens its correlated request/ack/progress/result chain.
- Clicking an escalation explains rejected candidates, selected owner, cost, and
  fallback history.

### Phase 4: Demo And Alpha Evidence

- Update the maintainer smoke test to require a Team Room walkthrough.
- Record a demo that shows agents moving from ready to busy to reviewing/completed.
- Add private-alpha feedback questions about whether users understood the team state.
- Treat confusing labels, hidden blockers, or mismatched visual state as launch
  blockers.

## Acceptance Criteria

- A user can identify what each agent is doing without opening terminal logs.
- A user can follow a task from request to acknowledgement to result to review/merge.
- A user can see blocked work and the reason it is blocked.
- A user can see model choice, cost estimate, budget impact, and escalation history.
- Visual state matches durable broker evidence after refresh and app restart.
- No default view exposes secrets, full prompts, or raw private terminal output.

## Tests

- Projection tests for ready, busy, blocked, failed, reviewing, and completed agents.
- Message-flow tests for correlated chains, retries, errors, and stale tasks.
- Workflow-board tests for dependency and approval states.
- Cost-strip tests for local/cloud routing, budgets, savings, and escalations.
- UI tests or component snapshots for empty, active, failed, and completed team rooms.
- Persistence test proving the Team Room restores from durable broker state.

## Open Questions

- Should Team Room replace the current Ops panel, or sit beside it as a more
  human-oriented view?
- Should message flow be a graph, a stream, or both?
- How much terminal output summary can be shown without creating privacy risk?
- Should agent cards support user-authored labels, colors, or icons for demos?
- Should the first implementation cover only workflows, or also ad hoc direct messages?
