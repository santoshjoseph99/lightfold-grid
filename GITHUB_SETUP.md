# GitHub Repository Setup

Lightfold Grid is ready to be pushed to GitHub, but this local checkout does not need
GitHub credentials to remain buildable. Use this checklist when creating the public or
private upstream repository.

## Existing Automation

The repository already includes:

- `.github/workflows/ci.yml` for Windows, macOS, and Linux validation.
- `.github/workflows/release.yml` for tagged alpha package builds and prereleases.
- `.github/workflows/codeql.yml` for CodeQL analysis.
- `.github/workflows/dependency-review.yml` for dependency review on pull requests.
- `.github/workflows/secret-scan.yml` for Gitleaks scanning.
- `.github/dependabot.yml` for npm and GitHub Actions updates.
- Issue forms, pull-request template, and label inventory.

The workflow checkout and Node setup steps use the current Node 24-ready major actions
so hosted validation does not depend on the deprecated Node 20 action runtime.

Run the local bootstrap audit:

```bash
npm run github:readiness
```

The audit fails only for repository-controlled setup regressions. It reports external
GitHub actions, such as adding a remote and observing hosted workflow runs, as blockers
without failing local development.

## Create The Repository

From GitHub, create an empty repository named `lightfold-grid` under the intended user
or organization. Do not initialize it with a README, license, or `.gitignore`; those
files already exist locally.

Then connect and push this checkout:

```bash
git remote add origin git@github.com:OWNER/lightfold-grid.git
git push -u origin main
```

If you prefer HTTPS:

```bash
git remote add origin https://github.com/OWNER/lightfold-grid.git
git push -u origin main
```

After pushing, open the repository's **Actions** tab and confirm the CI, CodeQL,
dependency review, and secret-scan workflows are enabled.

## Repository Settings

Recommended settings before public announcement:

- Set the default branch to `main`.
- Require pull requests before merging to `main`.
- Require the CI, CodeQL, dependency-review, and secret-scan checks before merge.
- Require conversation resolution and at least one maintainer approval.
- Enable GitHub private vulnerability reporting.
- Enable Dependabot alerts and security updates.
- Disable blank issues; the repository already uses structured issue forms.
- Create labels from `.github/labels.yml` before inviting external contributors.

## Secrets For Tagged Releases

Tagged alpha releases can build without signing only for manual development runs. A
trusted tagged release requires secrets documented in `RELEASE_SIGNING.md`:

- `MAC_CSC_LINK`
- `MAC_CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`

Do not add placeholder secrets. Leave them absent until real signing credentials are
available; the tagged release workflow will block signed platforms that lack them.

## First Hosted Validation

After the first push:

1. Confirm the `main` branch CI workflow runs on Windows, macOS, and Linux without
   Node 20 action-runtime deprecation warnings.
2. Confirm CodeQL completes successfully.
3. Open a test pull request to confirm dependency review and PR checks.
4. Run the **Alpha Release** workflow manually to verify downloadable unsigned CI
   artifacts, without creating a GitHub release.
5. Record hosted run links and outcomes in the next external evidence record.

Use `HOSTED_VALIDATION.md` for the evidence format and commands:

```bash
npm run hosted:collect -- --repo OWNER/lightfold-grid --branch main --commit "$(git rev-parse HEAD)" --output hosted-validation/latest.json
npm run hosted:validation -- hosted-validation/latest.json
```

Do not mark hosted CI, public repository launch, signing, notarization, or user
validation complete until those events have actually happened.
