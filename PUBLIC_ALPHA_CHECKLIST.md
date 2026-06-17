# Public Alpha Checklist

Lightfold Grid is ready for a public alpha only when repository-controlled gates pass
and maintainer-owned external evidence is collected. This checklist keeps those two
categories separate so the project does not overstate trust.

## Current Recommendation

The best point for a maintainer to test the app is now: hosted CI is green on Windows,
macOS, and Linux, and the next risk is real first-run usability rather than core
orchestration plumbing.

Run the maintainer smoke test below before inviting private-alpha users. Treat any
confusing setup step, unclear prompt, unexpected approval, failed readiness handshake,
or missing recovery path as a launch blocker.

## Repository Gates

Run these from a clean checkout before building or sharing an alpha artifact:

```bash
npm ci
npm run native:smoke
npm run alpha:readiness
npm run community:readiness
npm run release:signing-readiness
npm run github:readiness
npm run hosted:validation
npm test
npm run benchmark:reference
npm run benchmark:live:contract
git diff --exit-code -- benchmark-results
npm run test:integration
npm run build
npm audit --audit-level=high
```

Expected result: every command exits successfully. Readiness commands may report
external blockers, but repository readiness must pass.

## Hosted Evidence

After pushing `main`, wait for these hosted workflows to pass for the exact commit:

- `CI`
- `CodeQL`
- `Secret Scan`

Collect real hosted evidence outside the committed tree:

```bash
npm run hosted:collect -- --repo santoshjoseph99/lightfold-grid --branch main --commit "$(git rev-parse HEAD)" --output /tmp/lightfold-hosted-validation-latest.json
npm run hosted:validation -- /tmp/lightfold-hosted-validation-latest.json
```

Keep this evidence external unless you intentionally want a repository commit that
records a specific historical run. Committing `hosted-validation/latest.json` creates a
new commit, which then needs a new hosted run, so it is a poor default for everyday
validation.

## Maintainer Smoke Test

Use the platform you expect to hand to the first testers.

1. Create a package for the current platform:

   ```bash
   npm run package
   ```

2. Install or run the packaged app from `release/`.
3. Create a fresh disposable folder for the demo repository.
4. In Lightfold Grid, choose **Create Demo Project**.
5. Apply the **Local Ollama** + **Wheel** preset.
6. Use `gemma4-32k:latest` or deliberately record the replacement local model.
7. Wait for all four agents to report ready.
8. Send the safe starter task from the demo repository README to the orchestrator.
9. Watch the broker panel for request, acknowledgement, progress, result, and health
   events.
10. Confirm the coding task uses an isolated worktree and branch.
11. Let the configured test command run.
12. Review the changed files before approving the merge.
13. Export a diagnostic bundle and verify it contains no secrets or surprising local
   paths before sharing.
14. Quit and relaunch the app, then confirm the workspace and broker state reload.

Pass condition: the demo workflow completes without maintainer intervention beyond
documented approvals, and the user can explain what each agent did, what model it used,
what it cost or estimated, what tests ran, and what changed.

## External Blockers

Do not announce a broad public alpha until these are addressed or explicitly scoped:

- Name clearance: trademark, domains, social handles, app stores, and legal review.
- Signing credentials: macOS Developer ID, notarization, and Windows code-signing.
- Install trust: documented unsigned-build warnings for every shared artifact.
- Private-alpha sessions: 5-10 users who did not build the project complete the first
  workflow while observed.
- Demo evidence: a short recording showing routing, worktrees, tests, review, metrics,
  and model right-sizing.
- Live-model evidence: repeated pinned campaigns comparing strong-model, mixed-model,
  and local-only configurations before making performance claims.

## Alpha User Success Criteria

Count a private-alpha session as successful only when the user can:

- install or run the app from the provided artifact;
- complete the demo workflow without undocumented maintainer commands;
- identify which agent owned orchestration, building, testing, and review;
- inspect the broker timeline and the final changed files;
- understand when a cloud model would be used and how to constrain it;
- recover from at least one readiness or configuration issue using the documented path.

Record failures as product evidence, not user mistakes.
