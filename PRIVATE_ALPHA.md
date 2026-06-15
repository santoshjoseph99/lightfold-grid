# Private Alpha Guide

This guide makes private-alpha sessions repeatable without implying that repository
automation can replace real user evidence. A session should test whether someone who
did not build Lightfold Grid can install it, understand its trust boundaries, and
complete a useful first workflow.

## Participant Criteria

Recruit participants who:

- Use Git and at least one coding-agent CLI.
- Can test on Windows, macOS, or Linux.
- Did not build Lightfold Grid and have not previously completed its demo.
- Are willing to narrate confusing moments and report failures.

Do not ask participants to use a sensitive repository. The demo repository is the
default starting point.

## Consent And Privacy

Before the session, tell the participant:

- Lightfold Grid is experimental, launches arbitrary CLIs, and is not a sandbox.
- They control whether a screen, voice, logs, or diagnostics are recorded.
- They must remove credentials, private prompts, proprietary code, and personal data
  before sharing diagnostics or filing an issue.
- They may stop the session or decline any question at any time.

Record only the minimum evidence needed to improve the product. Do not publish raw
session material without explicit permission.

## Session Checklist

1. Ask the participant to read the README warning and install from the provided build
   or source checkout without maintainer intervention.
2. Ask them to complete the five-minute demo workflow using `QUICKSTART.md`.
3. Ask them to explain the configured agents, routing connections, approval gates,
   selected models, and expected costs in their own words.
4. Ask them to inspect the completed workflow, tests, review result, worktrees, model
   usage, and escalation history.
5. Ask them to try one safe workflow in a disposable repository of their own.
6. File structured feedback using the private-alpha issue form.

The observer may answer questions after the participant has attempted the relevant
step. Record each intervention because the public-alpha installation gate requires a
new user to complete the demo without maintainer help.

## Outcome Record

For every session, record:

- Operating system, installation path, and Lightfold Grid version or commit.
- Time to first ready agent and time to first completed workflow.
- Whether the demo and own-repository workflows completed.
- Number and reason for maintainer interventions.
- Confusing trust boundaries, approval prompts, routing decisions, or cost displays.
- Failures, recovery attempts, and whether the participant could self-diagnose them.
- Redacted suggestions and the participant's willingness to use the project again.

## Stop Conditions

Stop the session immediately if a credential or private repository content may have
been exposed, an unexpected destructive command runs, or the participant cannot tell
what an approval will do. Follow `SECURITY.md` for suspected vulnerabilities.

## Completion Criteria

Private-alpha validation is complete only when at least ten external users complete
the demo workflow, at least five complete a workflow in their own repository, and no
known critical secret-leakage or destructive-command vulnerability remains. Running
`npm run community:readiness` verifies this guide and the repository feedback loop; it
does not claim that any sessions have occurred.
