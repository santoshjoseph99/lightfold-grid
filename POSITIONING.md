# Positioning

## What Lightfold Grid Is

Lightfold Grid is a local desktop control plane for multi-agent coding teams. It sits
above individual CLI agents — local Ollama models, Anti-Gravity CLI (`agy`), GitHub
Copilot CLI, or any interactive CLI — and coordinates them through a central broker with
visual observability, durable state, cost-aware routing, and Git worktree isolation.

It does not replace your coding CLI. It orchestrates multiple CLIs as a team.

## The Problem

Single-agent CLIs are powerful but isolated: one agent, one task, one conversation, no
concept of a team. Multi-agent frameworks (AutoGen, CrewAI, LangGraph) are Python
libraries for developers building agent systems, not end-user applications. Cloud agent
platforms (Devin, Copilot Workspace) host your code and lock you to one provider.

There is no local-first, provider-agnostic, visually-orchestrated multi-agent coding
tool. Lightfold Grid fills that gap.

## How It Compares

| Category | Examples | What they do | What Lightfold Grid adds |
| --- | --- | --- | --- |
| Single-agent CLIs | Claude Code, Aider, `agy`, Copilot CLI | One agent works on one task | Orchestrates multiple CLIs as a coordinated team with routing, retries, and dependency workflows |
| Multi-agent frameworks | AutoGen, CrewAI, LangGraph, MetaGPT | Python libraries for defining agents in code | Desktop GUI with real-time broker visibility, durable state, and no Python required |
| Cloud agent platforms | Devin, Copilot Workspace, Factory.ai | Hosted multi-agent in the cloud | Runs locally with your models; no code leaves your machine unless you configure a cloud CLI |

## Key Differentiators

**Local-first.** Run the entire team on local Ollama models. No cloud dependency, no
data leaving your machine, no API costs for orchestration and testing.

**Model right-sizing.** The routing engine assigns each task to the least expensive
eligible model based on privacy, capability, tool support, context window, and cost.
Keep orchestration on a cheap local model and reserve cloud tokens for tasks that
genuinely need them. Enforce cost and cloud-usage budgets at the workflow level.

**Visual observability.** The broker panel shows every message, task transition, retry,
heartbeat, and failure in real time. Dependency graphs, operational metrics, and
correlated message chains are visible without reading raw terminal logs.

**Provider-agnostic.** Any interactive CLI agent can join the team through the adapter
system. Mix a local Ollama tester with an `agy` builder and a Copilot reviewer in the
same workflow. You are not locked into one AI company.

**Engineering safety.** Coding tasks run in isolated Git worktrees with declared file
ownership, test gates, and human merge approval. The broker tracks which agent touched
which files and blocks overlapping ownership.

## What It Is Not

- A replacement for your coding CLI. It orchestrates CLIs; it does not replace them.
- A Python framework for building agent systems. It is a desktop application.
- A cloud-hosted platform. It runs on your machine with your models.
- A production system. It is an experimental alpha with known limitations.

## Who It Is For

- Developers who want multi-agent coding with local models and full visibility.
- Teams that need cost control across local and cloud models.
- Researchers and educators studying multi-agent orchestration with a real protocol,
  durable state, and visual observability.
- Anyone who wants to experiment with mixed-model teams without sending their codebase
  to a cloud provider.

## Honest Limitations

- Tool calling works reliably with models that support native Ollama tool calls (e.g.
  `qwen3-coder:30b`). Text-based fallback for models without native tool calling is
  less reliable and may loop. See [ADAPTERS.md](./ADAPTERS.md).
- Workflow creation is a simple build → test → review chain from the New Task input.
  Custom workflow definitions with coding tasks, budgets, and approval gates are
  supported but require manual envelope construction.
- No MCP (Model Context Protocol) support yet.
- The UI is functional, not polished.
- Release signing, legal name clearance, and independent user validation are still
  external blockers before a broad public release. See
  [PUBLIC_ALPHA_CHECKLIST.md](./PUBLIC_ALPHA_CHECKLIST.md).
