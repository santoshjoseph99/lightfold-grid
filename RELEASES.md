# Releases

Lightfold Grid publishes experimental alpha artifacts for macOS, Linux, and Windows.
Tagged releases require signing credentials; manual and local packages may remain
unsigned. Review the checksum before installing, and expect unverified-development
artifacts to display an operating-system warning.

## Build Packages Locally

Install dependencies and create packages for the current operating system:

```bash
npm ci
npm run native:smoke
npm run alpha:readiness
npm run release:signing-readiness
npm test
npm run package
```

Platform-specific commands are also available:

```bash
npm run package:mac
npm run package:linux
npm run package:win
```

Artifacts are written to `release/`. Building a target generally requires running on
that target operating system because Lightfold Grid includes native `node-pty` and
SQLite modules.

## Alpha Release Process

1. Update the version in `package.json` and `package-lock.json`.
2. Run `npm ci`, `npm run native:smoke`, `npm run alpha:readiness`,
   `npm run release:signing-readiness`, `npm test`, `npm run test:integration`, and
   `npm run package`.
3. Commit the release version.
4. Create and push a matching tag such as `v0.1.0-alpha.2`.
5. Confirm the **Alpha Release** workflow succeeds on macOS, Linux, and Windows.

The tagged workflow requires the tag to exactly match the package version. It publishes
the platform packages, `SHA256SUMS.txt`, and an SPDX software bill of materials to a
prerelease GitHub release. A manual workflow run builds downloadable CI artifacts but
does not create a GitHub release.

Tagged releases require configured signing credentials and macOS notarization
credentials before packaging. Manual and local packages may remain unsigned. See
[RELEASE_SIGNING.md](./RELEASE_SIGNING.md) for required secrets, behavior, and rotation.
Do not describe unsigned alpha artifacts as trusted or production-ready.

## Verify A Download

Compare a downloaded artifact against `SHA256SUMS.txt`:

```bash
shasum -a 256 "Lightfold Grid-0.1.0-alpha.1-mac-arm64.dmg"
```

On Windows:

```powershell
Get-FileHash "Lightfold Grid-0.1.0-alpha.1-win-x64.exe" -Algorithm SHA256
```

## Data And Upgrades

Packaged builds store the workspace configuration and durable broker database in
Electron's per-user application-data directory:

- macOS: `~/Library/Application Support/Lightfold Grid`
- Linux: `~/.config/Lightfold Grid`
- Windows: `%APPDATA%\Lightfold Grid`

Existing Starlight configuration and broker files remain readable from their legacy
application-data directory. Installing a newer Lightfold Grid build keeps the current
workspace configuration, durable broker database, and audit history. Database schema
migrations run automatically when the application starts.

Before upgrading an important workspace, quit Lightfold Grid and back up its
application-data directory. Schema migrations are forward-only; rolling back to an
older build may not understand a database opened by a newer build. To roll back safely,
restore the matching application-data backup before launching the older build.

Uninstalling the application may leave its per-user application-data directory in
place. Remove that directory manually only after backing up any configuration,
diagnostics, or broker history you need.
