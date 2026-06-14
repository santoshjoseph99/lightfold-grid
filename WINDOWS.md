# Windows Support

Windows is a supported experimental development platform for Lightfold Grid.

The cross-platform CI matrix performs a clean install, deterministic tests, the real
`node-pty` integration harness, production build, and high-severity dependency audit on
Windows, macOS, and Linux.

## Requirements

- Windows 10 or newer
- Node.js 22.12 or newer
- Git for Windows
- PowerShell 5.1 or PowerShell 7
- npm

## Development

```powershell
npm ci
npm test
npm run test:integration
npm run build
npm run dev
```

PowerShell is the default interactive shell. PowerShell 7 is preferred when `pwsh.exe`
is available; Windows PowerShell is the fallback. Command Prompt and Git Bash can be
selected in workspace settings.

## Platform Behavior

- Interactive agent sessions use the selected Windows shell through ConPTY.
- Approved coding-task test commands execute through `cmd.exe /d /s /c`.
- Process readiness checks inspect direct child processes using PowerShell and CIM.
- Git worktrees, review gates, test execution, merges, and cleanup use the same workflow
  engine as macOS and Linux.
- Workspace paths, helper paths, and test fixtures accept Windows separators and line
  endings.

User-authored CLI commands and coding-task test commands are trusted configuration.
Shell quoting differs between PowerShell, Command Prompt, and Git Bash; test commands
in shared workspace files should use portable npm scripts where possible.

## Known Limitations

- Windows installers and code signing are not included yet.
- WSL agent sessions are not automatically discovered or translated.
- Process readiness observes direct child processes; CLIs that immediately daemonize
  may require manual investigation.
- Shell-specific commands in a workspace configuration are not automatically converted.

Report Windows defects using the bug template and include the Windows version, selected
shell, Node version, and a safely redacted diagnostic bundle.
