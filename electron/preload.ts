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

  onBrokerChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('broker:changed', listener);
    return () => {
      ipcRenderer.removeListener('broker:changed', listener);
    };
  }
});
