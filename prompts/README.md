# Lightfold Grid TDD Agent Prompts Handbook

This folder contains pre-configured system instructions for a multi-agent Test-Driven Development (TDD) workflow running on the Lightfold Grid split-pane terminal workspace.

## 👥 Agent Roster

1. **[Orchestrator](./orchestrator-instructions.md)**: Coordinates lifecycle phases and delegates work.
2. **[SpecBuilder](./specbuilder-instructions.md)**: Refines raw feature prompts into strict technical specs.
3. **[TestBuilder](./testbuilder-instructions.md)**: Writes assertions and unit tests matching specifications before code exists.
4. **[CodeBuilder](./codebuilder-instructions.md)**: Implements code to turn unit tests green.
5. **[TestRunner](./testrunner-instructions.md)**: Runs the test suite and captures stack trace failures.
6. **[CleanCoder](./cleancoder-instructions.md)**: Refactors passing green code to improve the implementation.
7. **[TestBreaker](./testbreaker-instructions.md)**: Adds boundary cases to expose hidden bugs.
8. **[Reviewer](./reviewer-instructions.md)**: Reviews correctness, complexity, and performance.
9. **[PRBuilder](./prbuilder-instructions.md)**: Packages verified features into commits and a PR description.

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

## How To Load In Lightfold Grid

For a new workspace, use **Start With Preset** to create role contracts and explicit
routes automatically. The built-in onboarding roles are intentionally smaller than this
full TDD roster.

To assemble this extended TDD team manually:

1. Split the terminal grid into the desired number of panes.
2. Click **Add Agent** and choose the CLI and model.
3. Load the markdown file matching the agent's role.
4. Configure explicit routes and verify each agent reports ready.

Lightfold Grid injects the real pane identity, allowed routes, capabilities, prompt version,
and current protocol instructions when the agent boots. Role prompt files intentionally
contain no pane IDs or hand-written message envelopes.
