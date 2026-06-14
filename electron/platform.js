import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';

const windowsShellNames = new Set(['cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe']);
const unixShellNames = new Set(['sh', 'bash', 'zsh', 'fish']);
const basename = (value) => path.win32.basename(path.posix.basename(value));

export const commandExecutable = (command = '') => {
  const match = command.trim().match(/^(?:"([^"]+)"|'([^']+)'|([^\s]+))/);
  return match?.[1] || match?.[2] || match?.[3] || '';
};

export const commandExists = (command, platform = process.platform) => {
  const executable = commandExecutable(command);
  if (!executable) return false;
  if (executable.includes('/') || executable.includes('\\')) return existsSync(executable);
  try {
    execFileSync(platform === 'win32' ? 'where.exe' : '/usr/bin/env', platform === 'win32' ? [executable] : ['which', executable], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
};

export const getDefaultShell = (platform = process.platform, env = process.env) => {
  if (platform === 'win32') return commandExists('pwsh.exe', platform) ? 'pwsh.exe' : 'powershell.exe';
  return env.SHELL || '/bin/sh';
};

export const getShellArgs = (executable, platform = process.platform) => {
  const name = basename(executable).toLowerCase();
  if (platform === 'win32') {
    if (name === 'powershell.exe' || name === 'powershell' || name === 'pwsh.exe' || name === 'pwsh') {
      return ['-NoLogo'];
    }
    if (name === 'bash.exe' || name === 'bash') return ['--login'];
    return [];
  }
  return ['-l'];
};

export const getAvailableShells = (platform = process.platform) => {
  if (platform === 'win32') {
    const candidates = [
      { name: 'PowerShell', path: 'powershell.exe' },
      { name: 'PowerShell 7', path: 'pwsh.exe' },
      { name: 'Command Prompt', path: process.env.ComSpec || 'cmd.exe' },
      { name: 'Git Bash', path: 'C:\\Program Files\\Git\\bin\\bash.exe' },
    ];
    return candidates.filter((shell, index) =>
      candidates.findIndex((candidate) => candidate.path.toLowerCase() === shell.path.toLowerCase()) === index &&
      commandExists(shell.path, platform)
    );
  }

  const candidates = [
    { name: 'Zsh', path: '/bin/zsh' },
    { name: 'Bash', path: '/bin/bash' },
    { name: 'Sh', path: '/bin/sh' },
    { name: 'Homebrew Zsh', path: '/opt/homebrew/bin/zsh' },
    { name: 'Homebrew Bash', path: '/opt/homebrew/bin/bash' },
    { name: 'Fish', path: '/opt/homebrew/bin/fish' },
    { name: 'Fish', path: '/usr/local/bin/fish' },
  ];
  return candidates.filter((shell, index) =>
    existsSync(shell.path) &&
    candidates.findIndex((candidate) => candidate.path === shell.path) === index
  );
};

export const getCommandSpec = (command, platform = process.platform, env = process.env) => platform === 'win32'
  ? { executable: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', command] }
  : { executable: '/bin/sh', args: ['-lc', command] };

export const isShellProcess = (value) => {
  const name = basename(value.trim()).toLowerCase();
  return windowsShellNames.has(name) || unixShellNames.has(name);
};

export const getActiveChildProcess = (parentPid, platform = process.platform) => {
  try {
    if (platform === 'win32') {
      const script = [
        `$child = Get-CimInstance Win32_Process -Filter "ParentProcessId = ${parentPid}" | Select-Object -First 1 -ExpandProperty Name`,
        'if ($child) { Write-Output $child }',
      ].join('; ');
      const output = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8',
        timeout: 2_000,
        windowsHide: true,
      }).trim();
      return output && !isShellProcess(output) ? output : 'shell';
    }

    const pids = execFileSync('pgrep', ['-P', String(parentPid)], { encoding: 'utf8', timeout: 2_000 })
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (pids.length === 0) return 'shell';
    const output = execFileSync('ps', ['-o', 'comm=', '-p', pids.join(',')], { encoding: 'utf8', timeout: 2_000 });
    return output.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !isShellProcess(line)) || 'shell';
  } catch {
    return 'shell';
  }
};
