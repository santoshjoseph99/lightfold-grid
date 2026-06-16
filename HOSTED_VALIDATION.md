# Hosted Validation Evidence

Hosted GitHub validation is external evidence: it proves the repository-controlled CI
configuration actually passed on GitHub-hosted runners. Local tests and workflow YAML
checks are not enough to mark this gate complete.

The repository includes a deterministic fixture contract:

```bash
npm run hosted:validation
```

That command validates `hosted-validation/example.json`. The fixture proves the schema
and checks; it is not evidence for the real repository.

## Capture Real Evidence

After pushing a commit, wait for these workflows on `main`:

- `CI`
- `CodeQL`
- `Secret Scan`

Then collect the hosted run and job evidence for the exact commit:

```bash
npm run hosted:collect -- --repo santoshjoseph99/lightfold-grid --branch main --commit "$(git rev-parse HEAD)" --output hosted-validation/latest.json
npm run hosted:validation -- hosted-validation/latest.json
```

The collector uses the GitHub CLI and records workflow runs, run URLs, job names,
job conclusions, branch, commit, and collection timestamp. The validator requires:

- the evidence commit to match every recorded run;
- the `CI` workflow to complete successfully;
- CI jobs for `ubuntu-latest`, `macos-latest`, and `windows-latest`;
- `CodeQL` to complete successfully;
- `Secret Scan` to complete successfully.

## What This Does Not Prove

Hosted validation does not prove a signed release, legal name clearance, private-alpha
success, or live-model performance. Those remain separate external evidence gates.

Do not mark hosted validation complete from queued, in-progress, failed, cancelled, or
fixture evidence. Record the GitHub run URLs so reviewers can inspect the original
source of truth.
