import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  spawnPty: (config: { id: string; cols: number; rows: number; shellPath?: string; cwd?: string }) => 
    ipcRenderer.invoke('pty:spawn', config),
  
  writePty: (id: string, data: string) => 
    ipcRenderer.invoke('pty:write', { id, data }),
  
  resizePty: (id: string, cols: number, rows: number) => 
    ipcRenderer.invoke('pty:resize', { id, cols, rows }),
  
  killPty: (id: string) => 
    ipcRenderer.invoke('pty:kill', id),
  
  getAvailableShells: () => 
    ipcRenderer.invoke('shells:get-available'),
  
  getActiveProcess: (id: string) => 
    ipcRenderer.invoke('pty:get-active-process', id),
  
  onPtyData: (id: string, callback: (data: string) => void) => {
    const channel = `pty:data:${id}`;
    const listener = (_event: any, data: string) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
  
  onPtyExit: (id: string, callback: (info: { exitCode: number; signal?: number }) => void) => {
    const channel = `pty:exit:${id}`;
    const listener = (_event: any, info: any) => callback(info);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
  
  selectPromptFile: () => 
    ipcRenderer.invoke('dialog:select-prompt-file'),
    
  saveWorkspaceConfig: (config: any) => 
    ipcRenderer.invoke('workspace:save-config', config),
    
  loadWorkspaceConfig: () => 
    ipcRenderer.invoke('workspace:load-config'),

  saveWorkspaceFile: (config: any) => 
    ipcRenderer.invoke('dialog:save-workspace-file', config),
    
  loadWorkspaceFile: () => 
    ipcRenderer.invoke('dialog:load-workspace-file'),

  selectWorkspaceDirectory: () => 
    ipcRenderer.invoke('dialog:select-workspace-directory'),

  createDemoProject: () =>
    ipcRenderer.invoke('dialog:create-demo-project'),
    
  logMessage: (cwd: string, message: any) =>
    ipcRenderer.invoke('workspace:log-message', { cwd, message }),

  getBrokerSnapshot: () =>
    ipcRenderer.invoke('broker:get-snapshot'),

  persistBrokerMessage: (message: any) =>
    ipcRenderer.invoke('broker:upsert-message', message),

  persistBrokerAgent: (agent: any) =>
    ipcRenderer.invoke('broker:upsert-agent', agent),

  persistBrokerWorkflow: (workflow: any) =>
    ipcRenderer.invoke('broker:upsert-workflow', workflow),

  setBrokerSetting: (key: string, value: any) =>
    ipcRenderer.invoke('broker:set-setting', { key, value }),

  runHealthChecks: (input: any) =>
    ipcRenderer.invoke('diagnostics:health-checks', input),

  exportDiagnostics: (input: any) =>
    ipcRenderer.invoke('diagnostics:export', input),

  getAgentHelperCommand: () =>
    ipcRenderer.invoke('agent:get-helper-command'),

  isGitRepository: (workspaceRoot: string) =>
    ipcRenderer.invoke('worktree:is-git-repository', workspaceRoot),

  prepareWorktree: (input: any) =>
    ipcRenderer.invoke('worktree:prepare', input),

  inspectWorktree: (workflowId: string, taskId: string) =>
    ipcRenderer.invoke('worktree:inspect', { workflowId, taskId }),

  runWorktreeTests: (workflowId: string, taskId: string) =>
    ipcRenderer.invoke('worktree:run-tests', { workflowId, taskId }),

  approveWorktreeReview: (workflowId: string, taskId: string) =>
    ipcRenderer.invoke('worktree:approve-review', { workflowId, taskId }),

  approveWorktreeSharedFiles: (workflowId: string, taskId: string) =>
    ipcRenderer.invoke('worktree:approve-shared-files', { workflowId, taskId }),

  mergeWorktree: (workflowId: string, taskId: string) =>
    ipcRenderer.invoke('worktree:merge', { workflowId, taskId }),

  cleanupWorktree: (workflowId: string, taskId: string, force = false) =>
    ipcRenderer.invoke('worktree:cleanup', { workflowId, taskId, force }),

  onBrokerChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('broker:changed', listener);
    return () => {
      ipcRenderer.removeListener('broker:changed', listener);
    };
  }
});
