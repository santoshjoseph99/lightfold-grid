import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { BrokerStore } from './brokerStore';
import { createDiagnosticBundle, runWorkspaceHealthChecks } from './diagnostics';
import { PtyService } from './ptyService';
import { WorktreeManager } from './worktreeManager';

let mainWindow: BrowserWindow | null = null;
let brokerStore: BrokerStore | null = null;
let worktreeManager: WorktreeManager | null = null;

// Generate a clean YYYYMMDD_HHMMSS timestamp for this run session
const sessionTimestamp = new Date().toISOString()
  .replace(/T/, '_')
  .replace(/\..+/, '')
  .replace(/[:]/g, '')
  .replace(/[-]/g, '');

// Helper to source user login shell environment paths on macOS
function getLoginShellEnv(): Record<string, string> {
  const defaultEnv = { ...process.env } as Record<string, string>;
  if (process.platform !== 'darwin') {
    return defaultEnv;
  }
  
  try {
    const userShell = process.env.SHELL || '/bin/zsh';
    // Run login shell to output env variables (timeout in 2 seconds)
    const envOutput = execSync(`${userShell} -lic "env"`, {
      encoding: 'utf-8',
      timeout: 2000,
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } // safe minimal path to start
    });
    
    const parsedEnv: Record<string, string> = {};
    envOutput.split('\n').forEach((line) => {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        if (key) parsedEnv[key] = value;
      }
    });
    
    // Merge paths and other details
    return { ...defaultEnv, ...parsedEnv };
  } catch (error) {
    console.error('Failed to source login shell env, falling back to process.env:', error);
    return defaultEnv;
  }
}

const mergedEnv = getLoginShellEnv();
const ptyService = new PtyService({
  onData: (id, data) => mainWindow?.webContents.send(`pty:data:${id}`, data),
  onExit: (id, exit) => mainWindow?.webContents.send(`pty:exit:${id}`, exit),
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Load from Vite dev server in development, or dist files in production
  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Clean up all PTYs
    ptyService.close();
  });
}

app.whenReady().then(() => {
  brokerStore = new BrokerStore(path.join(app.getPath('userData'), 'starlight-broker.sqlite'));
  brokerStore.recoverInterruptedWork();
  worktreeManager = new WorktreeManager({
    onUpdate: (record) => {
      brokerStore?.upsertWorktree(record);
      notifyBrokerChanged();
    },
  });
  worktreeManager.restore(brokerStore.snapshot().worktrees as any[]);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  brokerStore?.close();
  brokerStore = null;
  worktreeManager = null;
});

const notifyBrokerChanged = () => {
  mainWindow?.webContents.send('broker:changed');
};

ipcMain.handle('broker:get-snapshot', () => brokerStore?.snapshot());
ipcMain.handle('broker:upsert-message', (_event, message) => {
  brokerStore?.upsertMessage(message);
  notifyBrokerChanged();
  return true;
});
ipcMain.handle('broker:upsert-agent', (_event, agent) => {
  brokerStore?.upsertAgent(agent);
  notifyBrokerChanged();
  return true;
});
ipcMain.handle('broker:upsert-workflow', (_event, workflow) => {
  brokerStore?.upsertWorkflow(workflow);
  notifyBrokerChanged();
  return true;
});
ipcMain.handle('broker:set-setting', (_event, { key, value }) => {
  brokerStore?.setSetting(key, value);
  notifyBrokerChanged();
  return true;
});
ipcMain.handle('diagnostics:health-checks', (_event, input) => runWorkspaceHealthChecks(input || {}));
ipcMain.handle('diagnostics:export', async (_event, input) => {
  if (!mainWindow || !brokerStore) return { success: false, error: 'Broker is not ready.' };
  const health = runWorkspaceHealthChecks(input || {});
  const bundle = createDiagnosticBundle({
    snapshot: brokerStore.snapshot(),
    health,
    workspace: input,
  });
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Starlight Diagnostic Bundle',
    defaultPath: `starlight-diagnostics-${sessionTimestamp}.json`,
    filters: [{ name: 'JSON Diagnostic Bundle', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { success: false, error: 'Canceled' };
  fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2), 'utf8');
  return { success: true, path: filePath };
});
ipcMain.handle('agent:get-helper-command', () => {
  const helperPath = path.join(app.getAppPath(), 'bin', 'starlight-message.mjs');
  return `"${helperPath}"`;
});

const worktreeOperation = (operation: () => unknown) => {
  try {
    return { success: true, record: operation() };
  } catch (error: any) {
    return { success: false, error: error.message || String(error) };
  }
};

ipcMain.handle('worktree:is-git-repository', (_event, workspaceRoot) =>
  worktreeManager?.isGitRepository(workspaceRoot) || false
);
ipcMain.handle('worktree:prepare', (_event, { workspaceRoot, workflowId, taskId, owner, config }) =>
  worktreeOperation(() => worktreeManager?.prepare(workspaceRoot, workflowId, taskId, owner, config))
);
ipcMain.handle('worktree:inspect', (_event, { workflowId, taskId }) =>
  worktreeOperation(() => worktreeManager?.inspect(workflowId, taskId))
);
ipcMain.handle('worktree:run-tests', (_event, { workflowId, taskId }) =>
  worktreeOperation(() => worktreeManager?.runTests(workflowId, taskId))
);
ipcMain.handle('worktree:approve-review', (_event, { workflowId, taskId }) =>
  worktreeOperation(() => worktreeManager?.approveReview(workflowId, taskId))
);
ipcMain.handle('worktree:approve-shared-files', (_event, { workflowId, taskId }) =>
  worktreeOperation(() => worktreeManager?.approveSharedFiles(workflowId, taskId))
);
ipcMain.handle('worktree:merge', (_event, { workflowId, taskId }) =>
  worktreeOperation(() => worktreeManager?.merge(workflowId, taskId))
);
ipcMain.handle('worktree:cleanup', (_event, { workflowId, taskId, force }) =>
  worktreeOperation(() => worktreeManager?.cleanup(workflowId, taskId, force))
);

// IPC Handlers for PTY lifecycle
ipcMain.handle('pty:spawn', (event, { id, cols, rows, shellPath, cwd }) => {
  try {
    const selectedShell = shellPath || process.env.SHELL || '/bin/zsh';
    const targetCwd = cwd && fs.existsSync(cwd) ? cwd : app.getPath('home');

    // Create log folder structure for this run
    const logsDir = path.join(targetCwd, 'logs', `run_${sessionTimestamp}`);
    const logFilePath = path.join(logsDir, `${id}.log`);

    return ptyService.spawn({
      id,
      executable: selectedShell,
      args: ['-l'],
      cols: cols || 80,
      rows: rows || 24,
      cwd: targetCwd,
      env: {
        ...mergedEnv,
        STARLIGHT_WORKSPACE: 'true',
        TERM: 'xterm-256color'
      },
      logFilePath,
    });
  } catch (error: any) {
    console.error('Failed to spawn PTY:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('pty:write', (event, { id, data }) => {
  return ptyService.write(id, data);
});

ipcMain.handle('pty:resize', (event, { id, cols, rows }) => {
  try {
    return ptyService.resize(id, cols, rows);
  } catch (e) {
    console.error('Failed to resize PTY:', e);
    return false;
  }
});

ipcMain.handle('pty:kill', (event, id) => {
  return ptyService.kill(id);
});

// Get available shells on the host machine
ipcMain.handle('shells:get-available', () => {
  const defaultShells = [
    { name: 'Zsh', path: '/bin/zsh' },
    { name: 'Bash', path: '/bin/bash' },
    { name: 'Sh', path: '/bin/sh' },
  ];

  if (process.platform === 'win32') {
    return [
      { name: 'PowerShell', path: 'powershell.exe' },
      { name: 'Command Prompt', path: 'cmd.exe' },
      { name: 'Git Bash', path: 'C:\\Program Files\\Git\\bin\\bash.exe' },
    ];
  }

  // Check which UNIX shells actually exist
  const availableShells = defaultShells.filter((s) => fs.existsSync(s.path));
  
  // Try checking common homebrew/custom installations
  const homebrewZsh = '/opt/homebrew/bin/zsh';
  const homebrewBash = '/opt/homebrew/bin/bash';
  const fishShell = '/opt/homebrew/bin/fish';
  const usrLocalFish = '/usr/local/bin/fish';

  if (fs.existsSync(homebrewZsh)) availableShells.push({ name: 'Homebrew Zsh', path: homebrewZsh });
  if (fs.existsSync(homebrewBash)) availableShells.push({ name: 'Homebrew Bash', path: homebrewBash });
  if (fs.existsSync(fishShell)) availableShells.push({ name: 'Fish', path: fishShell });
  else if (fs.existsSync(usrLocalFish)) availableShells.push({ name: 'Fish', path: usrLocalFish });

  return availableShells;
});

// Fetch active process name under a PTY for busy checking
ipcMain.handle('pty:get-active-process', (event, id) => {
  const pid = ptyService.pid(id);
  if (!pid) return 'none';
  
  try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      // Run ps to find child processes of the PTY session group
      const output = execSync(`pgrep -P ${pid} | xargs ps -o state,comm -p`, { encoding: 'utf-8' });
      const lines = output.trim().split('\n').slice(1);
      
      // Look for active processes (not sleeping shell)
      let activeProcess = 'shell';
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const state = parts[0];
          const name = parts.slice(1).join(' ');
          // If the process state doesn't represent background sleep, return it
          if (!name.includes('zsh') && !name.includes('bash') && !name.includes('fish') && !name.includes('sh')) {
            activeProcess = name;
            break;
          }
        }
      }
      return activeProcess;
    }
    return 'unknown';
  } catch {
    return 'shell'; // default fallback
  }
});

function getConfigPath(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), 'starlight-workspace.json');
  }
  return path.join(process.cwd(), 'starlight-workspace.json');
}

ipcMain.handle('workspace:save-config', async (event, config) => {
  try {
    const configPath = getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return { success: true, path: configPath };
  } catch (e: any) {
    console.error('Failed to save workspace config:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('workspace:load-config', async () => {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      return { success: true, config: JSON.parse(data) };
    }
    return { success: false, error: 'Config file not found' };
  } catch (e: any) {
    console.error('Failed to load workspace config:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('workspace:log-message', async (event, { cwd, message }) => {
  try {
    const targetCwd = cwd && fs.existsSync(cwd) ? cwd : app.getPath('home');
    const logsDir = path.join(targetCwd, 'logs', `run_${sessionTimestamp}`);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const logFilePath = path.join(logsDir, 'broker.json');
    fs.appendFileSync(logFilePath, JSON.stringify(message) + '\n', 'utf-8');
    return { success: true };
  } catch (e: any) {
    console.error('Failed to log broker message:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dialog:select-prompt-file', async () => {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Prompt Instruction File',
    properties: ['openFile'],
    filters: [{ name: 'Markdown & Text', extensions: ['md', 'txt', 'json'] }]
  });
  
  if (canceled || filePaths.length === 0) return null;
  
  try {
    const filePath = filePaths[0];
    const content = fs.readFileSync(filePath, 'utf-8');
    return { path: filePath, content };
  } catch (e: any) {
    console.error('Failed to read selected prompt file:', e);
    return null;
  }
});

ipcMain.handle('dialog:save-workspace-file', async (event, config) => {
  if (!mainWindow) return { success: false, error: 'No main window' };
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Workspace Configuration',
    defaultPath: 'starlight-workspace.json',
    filters: [{ name: 'JSON Configuration', extensions: ['json'] }]
  });
  
  if (canceled || !filePath) return { success: false, error: 'Canceled' };
  
  try {
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
    return { success: true, path: filePath };
  } catch (e: any) {
    console.error('Failed to save custom workspace config:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dialog:load-workspace-file', async () => {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Load Workspace Configuration',
    properties: ['openFile'],
    filters: [{ name: 'JSON Configuration', extensions: ['json'] }]
  });
  
  if (canceled || filePaths.length === 0) return null;
  
  try {
    const data = fs.readFileSync(filePaths[0], 'utf-8');
    return { success: true, config: JSON.parse(data), path: filePaths[0] };
  } catch (e: any) {
    console.error('Failed to load custom workspace config:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('dialog:select-workspace-directory', async () => {
  if (!mainWindow) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Project Root Directory',
    properties: ['openDirectory']
  });
  
  if (canceled || filePaths.length === 0) return null;
  return filePaths[0];
});
