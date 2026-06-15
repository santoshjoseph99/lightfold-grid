# Release Signing And Notarization

Lightfold Grid supports unsigned local and manually dispatched alpha packages, but
tagged releases are configured to require platform signing credentials. Repository
automation must never present an unsigned tagged release as trusted.

Run the repository preparation audit:

```bash
npm run release:signing-readiness
```

This verifies the project-authored application icons, macOS hardened runtime and
entitlements, notarization hook, and tagged-release credential gate. It reports missing
maintainer credentials as external blockers without failing local development.

## Tagged Release Credentials

Configure these GitHub Actions secrets before pushing a release tag:

| Platform | Required secrets |
| --- | --- |
| macOS | `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Windows | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` |

`MAC_CSC_LINK` and `WIN_CSC_LINK` may use an electron-builder-supported certificate
file, URL, or base64 value. Passwords and Apple credentials must remain repository
secrets and must never be committed, logged, included in diagnostics, or placed in
benchmark evidence.

The tagged release matrix runs a platform-specific credential requirement before
packaging:

```bash
npm run release:signing-readiness -- --require-credentials mac
npm run release:signing-readiness -- --require-credentials win
```

macOS packaging uses hardened runtime, signs with the configured Developer ID
certificate, and runs the credential-aware notarization hook. Windows packaging passes
the configured publisher certificate to electron-builder. Linux artifacts do not have
an equivalent signing credential gate and remain protected by published checksums.

## Manual And Local Builds

Manual workflow dispatches and local builds may remain unsigned so contributors can
test packages without maintainer credentials. These artifacts are development outputs,
not trusted releases, and operating systems may display unverified-publisher warnings.

## Credential Rotation

When rotating or revoking credentials:

1. Replace or remove the corresponding GitHub Actions secrets.
2. Run a manually dispatched package build to verify unsigned development packaging.
3. Push a release tag only after credential-required checks pass on a protected branch.
4. Verify signatures, notarization, checksums, and the SBOM before announcing the release.

Actual certificates, notarization acceptance, and trusted-publisher status remain
external evidence until a tagged release completes successfully.
