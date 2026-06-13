# Starlight TDD Agent Prompts Handbook

This folder contains pre-configured system instructions for a multi-agent Test-Driven Development (TDD) workflow running on the Starlight split-pane terminal workspace.

## 👥 Agent Roster

1. **[Orchestrator](./orchestrator-instructions.md)** (Hub - `Pane-A`): Coordinates the lifecycle phases. Delegates tasks to specialist spokes.
2. **[SpecBuilder](./specbuilder-instructions.md)** (Spoke - `Pane-B`): Refines raw feature prompts into strict technical specs.
3. **[TestBuilder](./testbuilder-instructions.md)** (Spoke - `Pane-C`): Writes assertions and unit tests matching specifications before code exists.
4. **[CodeBuilder](./codebuilder-instructions.md)** (Spoke - `Pane-D`): Implements the code to turn unit tests green.
5. **[TestRunner](./testrunner-instructions.md)** (Spoke - `Pane-E`): Runs the test suite and captures stack trace failures.
6. **[CleanCoder](./cleancoder-instructions.md)** (Spoke - `Pane-F`): Refactors passing green code to clean up formatting/architecture.
7. **[TestBreaker](./testbreaker-instructions.md)** (Spoke - `Pane-G`): Appends chaos boundary edge cases to expose hidden bugs.
8. **[Reviewer](./reviewer-instructions.md)** (Spoke - `Pane-H`): Reviews styling, complexity, and performance of implementation.
9. **[PRBuilder](./prbuilder-instructions.md)** (Spoke - `Pane-I`): Packages verified features into commits and pushes a PR description.

## 🔄 TDD Phase Sequence Diagram

```
User Prompt ➔ Orchestrator
                 │
                 ├──[Spec Phase]──────➔ SpecBuilder (writes spec.md)
                 │
                 ├──[Red Phase]───────➔ TestBuilder (writes tests) ➔ TestRunner (asserts fail)
                 │
                 ├──[Green Phase]─────➔ CodeBuilder (writes code)  ➔ TestRunner (asserts green)
                 │
                 ├──[Refactor Phase]──➔ CleanCoder (cleans code)   ➔ TestRunner (verify green)
                 │
                 ├──[Chaos Phase]─────➔ TestBreaker (adds fuzzing)  ➔ TestRunner (harden code)
                 │
                 ├──[Review Phase]────➔ Reviewer (audits code)
                 │
                 └──[Ship Phase]──────➔ PRBuilder (commits & opens PR)
```

## 🚀 How to Load in Starlight
1. Split your terminal grid into the desired amount of panes (e.g. 4 panes).
2. Click **Add Agent** in the left sidebar.
3. Choose the appropriate preset (like Gemini) and click **Load Prompt**.
4. Navigate to this repository's `prompts/` folder and select the markdown file matching the agent's role.
5. Boot the agent!
