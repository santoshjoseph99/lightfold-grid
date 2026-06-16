# Public Alpha Readiness

Lightfold Grid separates public-alpha readiness into repository-controlled gates and
external blockers.

Run the repository audit:

```bash
npm run native:smoke
npm run alpha:readiness
```

`native:smoke` launches through Electron's Node runtime and verifies that the packaged
application ABI can load SQLite and create a real `node-pty` process. CI and release
workflows run it on Windows, macOS, and Linux.

`alpha:readiness` checks version and license metadata, public policies, prominent known
limitations, cross-platform CI, native smoke coverage, security approvals, diagnostic
redaction evidence, source provenance, and reproducible benchmark summaries. A missing
repository-controlled gate exits unsuccessfully.

The repository gate also validates the pinned live-model evidence contract and fixture
campaign. Actual live-model outcomes remain external evidence.

It also runs the release-signing preparation audit. Project identity, hardened-runtime
configuration, notarization hooks, and tagged-release gates are repository evidence;
real certificates and successful signed hosted releases remain external.

The hosted-validation contract is repository evidence. Actual hosted GitHub run URLs
remain external evidence until collected for the exact pushed commit.

External blockers are reported but do not make the repository audit exit unsuccessfully:

- successful hosted Windows, macOS, and Linux CI runs on the public branch;
- legal name, domain, app-store, and trademark clearance;
- release signing and notarization credentials;
- independent new-user installation and workflow validation; and
- repeated pinned live-model benchmark comparisons.

These blockers require maintainer credentials, legal review, or real participants and
must not be represented as complete by repository automation.
