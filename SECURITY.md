# Security Policy

## Supported Versions

Lightfold Grid is an experimental developer alpha. Until the first public release,
security fixes are applied only to the latest commit on the default branch.

| Version | Supported |
| --- | --- |
| Default branch | Yes |
| Older commits and private builds | No |

## Reporting A Vulnerability

Do not open a public issue for suspected vulnerabilities.

Use GitHub's private **Report a vulnerability** feature for this repository. If private
reporting is unavailable, contact a maintainer privately and request a secure reporting
channel without including exploit details in public.

Include affected versions, impact, reproduction steps, and any suggested mitigation.
Maintainers aim to acknowledge a report within seven days, provide a status update
within fourteen days, and coordinate disclosure after a fix is available.

## Trust Model

Lightfold Grid is a local orchestration control plane, not a sandbox.

- Configured agent CLIs run with the current user's permissions.
- Agent CLIs and coding tasks can read and modify selected repositories.
- Approved coding tasks execute their configured test command through `/bin/sh` on
  macOS/Linux or `cmd.exe` on Windows.
- The built-in YOLO toggle requires an explicit warning confirmation, is never
  persisted across restarts, then reduces or removes the selected CLI's own confirmation
  prompts. User-authored CLI command strings remain trusted configuration.
- Local and cloud providers may receive prompts, repository content, or command output
  according to their own configuration and privacy policies.
- Terminal logs, the broker database, workspace files, and diagnostic exports can
  contain sensitive repository or model output.

Only use trusted CLIs, models, prompts, repositories, and test commands. Run Lightfold
Grid under an isolated operating-system account or container when stronger isolation is
required.

## Existing Controls

- The physical source pane is authoritative for agent identity.
- Message routes are checked against the configured connection graph.
- Coding workflow dispatch requires explicit approval.
- Test execution, review, and merge are separate workflow stages.
- File ownership conflicts and merges require explicit review.
- Release, deployment, production, deletion, destruction, and migration goals are
  automatically flagged for approval.
- Diagnostic exports redact common credential keys and values.

These controls reduce risk but do not make untrusted commands safe.

## Threat Model

The project treats these as primary threats:

- Prompt injection from repositories, issue text, prompts, terminal output, or agents.
- Malicious or compromised CLIs and models.
- Unsafe test commands and repository scripts.
- Secret leakage to logs, diagnostics, providers, prompts, or committed files.
- Agent impersonation, unauthorized routes, replayed messages, and malformed envelopes.
- Destructive commands, unsafe merges, and supply-chain compromise.

Security-relevant changes should include tests and update this policy when the trust
model changes.
