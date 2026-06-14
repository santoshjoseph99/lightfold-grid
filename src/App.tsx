import React, { useState, useEffect, useRef } from 'react';
import { Columns, Sliders, Layout, ChevronLeft, ChevronRight, Star, Plus, Link2, Save, FolderOpen, Folder, Sparkles } from 'lucide-react';
import { TerminalGrid } from './components/TerminalGrid';
import { CentralBroker } from './components/CentralBroker';
import { SettingsModal, AgentConfig } from './components/SettingsModal';
import { AddAgentModal } from './components/AddAgentModal';
import { AddConnectionModal } from './components/AddConnectionModal';
import { ApprovalOverlay } from './components/ApprovalOverlay';
import { WorkspacePresetModal } from './components/WorkspacePresetModal';
import { WorkspacePreset } from './services/workspacePresets';
import {
  removeTerminalInstance,
  createTerminalInstance,
  getTerminalInstance,
  subscribeToTerminalExit,
} from './services/terminalRegistry';
import {
  checkAgentHealth,
  getAgentLifecycles,
  getRoutingConnections,
  initializeBrokerState,
  markAgentFailed,
  markAgentStarting,
  markAgentStopped,
  markAgentStopping,
  registerAgent,
  setBrokerWorkspaceRoot,
  setRoutingConnections,
  subscribeToMessages,
} from './services/brokerProtocol';
import {
  AGENT_PROMPT_VERSION,
  DEFAULT_AGENT_CAPABILITIES,
  generateAgentPromptContract,
  normalizeCapabilities,
} from './services/promptContract';
import { disablePersistedYoloModes } from './services/securityPolicy';

const STARTUP_TIMEOUT_MS = 20_000;
const STARTUP_POLL_MS = 250;
const HEALTH_CHECK_MS = 5_000;

const sleep = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs));

export default function App() {
  const [paneIds, setPaneIds] = useState<string[]>(['Pane-A']);
  const [activePaneId, setActivePaneId] = useState<string>('Pane-A');
  const [defaultShell, setDefaultShell] = useState<string>('');
  const [workspaceCwd, setWorkspaceCwd] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [showAddConnection, setShowAddConnection] = useState(false);
  const [showWorkspacePresets, setShowWorkspacePresets] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  
  // Agent configs mapped by pane ID
  const [agentConfigs, setAgentConfigs] = useState<Record<string, AgentConfig>>({});
  const [connections, setConnections] = useState<Record<string, string[]>>({});
  const bootingAgents = useRef(new Set<string>());

  // Helper to save workspace state to local disk config
  const saveWorkspace = (
    nextPaneIds = paneIds,
    nextActivePaneId = activePaneId,
    nextAgentConfigs = agentConfigs,
    nextShell = defaultShell,
    nextWorkspaceCwd = workspaceCwd
  ) => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) return;
    
    const config = {
      paneIds: nextPaneIds,
      activePaneId: nextActivePaneId,
      agentConfigs: disablePersistedYoloModes(nextAgentConfigs),
      connections: getRoutingConnections(),
      defaultShell: nextShell,
      workspaceCwd: nextWorkspaceCwd
    };
    electronAPI.saveWorkspaceConfig(config);
  };

  // Initialize shell path configurations and load workspace from disk on launch
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI) {
      // 1. Fetch available shells
      electronAPI.getAvailableShells().then((shells: any[]) => {
        if (shells && shells.length > 0) {
          setDefaultShell(shells[0].path);
        }
      });
      
      // 2. Load workspace config from disk
      void initializeBrokerState().then(() => electronAPI.loadWorkspaceConfig()).then((res: any) => {
        if (res.success && res.config) {
          const cfg = res.config;
          if (cfg.paneIds && cfg.paneIds.length > 0) {
            setPaneIds(cfg.paneIds);
          }
          if (cfg.activePaneId) {
            setActivePaneId(cfg.activePaneId);
          }
          if (cfg.agentConfigs) {
            setAgentConfigs(disablePersistedYoloModes(cfg.agentConfigs));
          }
          if (cfg.connections) {
            setRoutingConnections(cfg.connections);
            setConnections(cfg.connections);
          }
          if (cfg.defaultShell) {
            setDefaultShell(cfg.defaultShell);
          }
          if (cfg.workspaceCwd) {
            setWorkspaceCwd(cfg.workspaceCwd);
          }
        }
      });
    }
  }, []);

  // Subscribe to broker messages and write updates to disk log files
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI || !workspaceCwd) return;

    const unsubscribe = subscribeToMessages((msg) => {
      electronAPI.logMessage(workspaceCwd, msg);
    });

    return unsubscribe;
  }, [workspaceCwd]);

  useEffect(() => {
    setBrokerWorkspaceRoot(workspaceCwd);
  }, [workspaceCwd]);

  const handleSplit = (): string | null => {
    if (paneIds.length >= 30) {
      alert('Maximum of 30 terminal tabs supported for workspace stability.');
      return null;
    }

    // Determine name for the new terminal tab
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let nextLetter = '';
    
    for (let char of alphabet) {
      if (!paneIds.includes(`Pane-${char}`)) {
        nextLetter = char;
        break;
      }
    }
    
    if (!nextLetter) {
      let counter = 1;
      while (paneIds.includes(`Pane-${counter}`)) {
        counter++;
      }
      nextLetter = counter.toString();
    }
    
    const newPaneId = `Pane-${nextLetter}`;
    const nextPaneIds = [...paneIds, newPaneId];
    setPaneIds(nextPaneIds);
    setActivePaneId(newPaneId);
    
    saveWorkspace(nextPaneIds, newPaneId);
    return newPaneId;
  };

  const handleClosePane = (id: string) => {
    markAgentStopping(id);
    removeTerminalInstance(id);
    markAgentStopped(id);
    const updated = paneIds.filter((p) => p !== id);
    setPaneIds(updated);
    
    let nextActive = activePaneId;
    if (activePaneId === id && updated.length > 0) {
      nextActive = updated[0];
      setActivePaneId(nextActive);
    }
    
    const nextAgentConfigs = { ...agentConfigs };
    delete nextAgentConfigs[id];
    setAgentConfigs(nextAgentConfigs);
    
    saveWorkspace(updated, nextActive, nextAgentConfigs);
  };

  const handleSelectShell = (path: string) => {
    setDefaultShell(path);
    saveWorkspace(paneIds, activePaneId, agentConfigs, path);
  };

  const handleSaveAgentConfigs = (configs: Record<string, AgentConfig>) => {
    setAgentConfigs(configs);
    // Sync connections state in case SettingsModal modified them in-memory
    setConnections(getRoutingConnections());
    saveWorkspace(paneIds, activePaneId, configs);
  };

  const handleSaveConnections = (newConnections: Record<string, string[]>) => {
    setRoutingConnections(newConnections);
    setConnections(newConnections);
    saveWorkspace(paneIds, activePaneId, agentConfigs);
  };

  const handleApplyWorkspacePreset = (preset: WorkspacePreset) => {
    paneIds.forEach((paneId) => {
      markAgentStopping(paneId);
      removeTerminalInstance(paneId);
      markAgentStopped(paneId);
    });
    setPaneIds(preset.paneIds);
    setActivePaneId(preset.activePaneId);
    setAgentConfigs(preset.agentConfigs);
    setRoutingConnections(preset.connections);
    setConnections(preset.connections);
    saveWorkspace(
      preset.paneIds,
      preset.activePaneId,
      preset.agentConfigs,
      defaultShell,
      workspaceCwd,
    );
  };

  const applyWorkspaceConfig = (cfg: any) => {
    if (cfg.paneIds && cfg.paneIds.length > 0) {
      // Clean up previous terminal pane processes to prevent leaking
      paneIds.forEach((pid) => {
        if (!cfg.paneIds.includes(pid)) {
          removeTerminalInstance(pid);
        }
      });
      setPaneIds(cfg.paneIds);
    }
    if (cfg.activePaneId) {
      setActivePaneId(cfg.activePaneId);
    }
    if (cfg.agentConfigs) {
      setAgentConfigs(disablePersistedYoloModes(cfg.agentConfigs));
    }
    if (cfg.connections) {
      setRoutingConnections(cfg.connections);
      setConnections(cfg.connections);
    }
    if (cfg.defaultShell) {
      setDefaultShell(cfg.defaultShell);
    }
    if (cfg.workspaceCwd) {
      setWorkspaceCwd(cfg.workspaceCwd);
    }
  };

  const handleSaveWorkspaceFile = async () => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) return;

    const config = {
      paneIds,
      activePaneId,
      agentConfigs,
      connections: getRoutingConnections(),
      defaultShell
    };

    const res = await electronAPI.saveWorkspaceFile(config);
    if (res && res.success) {
      alert(`Workspace configuration saved successfully to:\n${res.path}`);
    }
  };

  const handleLoadWorkspaceFile = async () => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) return;

    const res = await electronAPI.loadWorkspaceFile();
    if (res && res.success && res.config) {
      applyWorkspaceConfig(res.config);
      // Auto-save this loaded file as the current default workspace config
      saveWorkspace(
        res.config.paneIds,
        res.config.activePaneId,
        disablePersistedYoloModes(res.config.agentConfigs),
        res.config.defaultShell,
        res.config.workspaceCwd,
      );
      alert(`Loaded workspace configuration from:\n${res.path}`);
    }
  };

  const handleSelectWorkspaceDirectory = async () => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) return;

    const path = await electronAPI.selectWorkspaceDirectory();
    if (path) {
      setWorkspaceCwd(path);
      saveWorkspace(paneIds, activePaneId, agentConfigs, defaultShell, path);
      
      alert(`Workspace root directory set to:\n${path}\n\nAll terminal agent instances have been rebooted in the new directory!`);
    }
  };

  const handleCreateDemoProject = async () => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI) return;
    const result = await electronAPI.createDemoProject();
    if (!result?.success) {
      if (result?.error !== 'Canceled') alert(`Could not create demo project:\n${result?.error || 'Unknown error'}`);
      return;
    }
    setWorkspaceCwd(result.path);
    saveWorkspace(paneIds, activePaneId, agentConfigs, defaultShell, result.path);
    setShowWorkspacePresets(true);
  };

  const buildBootCommand = (config: AgentConfig): string => {
    let cmd = config.cliCommand || '';
    const isGemini = cmd.toLowerCase().includes('gemini');
    const isCopilot = cmd.toLowerCase().includes('copilot');
    const isOllama = cmd.toLowerCase().includes('ollama');

    // Append model option if not already specified in the command
    // Omit if "auto" (case-insensitive) to support Gemini CLI's native Auto Routing
    if (config.selectedModel && config.selectedModel.toLowerCase() !== 'auto') {
      if (isGemini && !cmd.includes('-m') && !cmd.includes('--model')) {
        cmd += ` -m ${config.selectedModel}`;
      } else if (isCopilot && !cmd.includes('-m') && !cmd.includes('--model')) {
        cmd += ` --model ${config.selectedModel}`;
      } else if (isOllama && !cmd.includes(config.selectedModel)) {
        cmd += ` ${config.selectedModel}`;
      }
    }

    // Append prompt file path option if present
    if (config.promptPath) {
      if (isGemini && !cmd.includes('-s') && !cmd.includes('--system')) {
        cmd += ` -s "${config.promptPath}"`;
      }
    }

    // Append YOLO flag if checked
    if (config.yoloMode) {
      if (isGemini && !cmd.includes('-y') && !cmd.includes('--yolo')) {
        cmd += ' --yolo';
      } else if (isCopilot && !cmd.includes('--yolo')) {
        cmd += ' --yolo';
      } else if (isOllama && !cmd.includes('--experimental-yolo')) {
        cmd += ' --experimental-yolo';
      } else if (!isGemini && !isCopilot && !isOllama && !cmd.includes('--yolo')) {
        cmd += ' --yolo';
      }
    }

    return cmd;
  };

  const waitForAgentProcess = async (paneId: string) => {
    const electronAPI = (window as any).electronAPI;
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const processName = await electronAPI.getActiveProcess(paneId);
      if (processName && !['none', 'shell'].includes(processName)) {
        return processName as string;
      }
      await sleep(STARTUP_POLL_MS);
    }
    throw new Error(`Agent CLI did not start within ${STARTUP_TIMEOUT_MS / 1000} seconds.`);
  };

  // Launch the configured CLI and wait for an observable child process before
  // asking the agent to complete the Lightfold Grid readiness handshake.
  const handleBootPane = async (paneId: string, customConfig?: AgentConfig, restart = false) => {
    const config = customConfig || agentConfigs[paneId];
    if (!config) {
      alert(`Please configure the Agent Profile for ${paneId} first in workspace settings!`);
      return;
    }

    const electronAPI = (window as any).electronAPI;
    if (!electronAPI || bootingAgents.current.has(paneId)) return;

    const lifecycle = getAgentLifecycles().find((record) => record.agentId === paneId);
    if (!restart && ['starting', 'ready', 'busy'].includes(lifecycle?.state || '')) return;

    bootingAgents.current.add(paneId);
    try {
      if (restart) {
        markAgentStopping(paneId);
        removeTerminalInstance(paneId);
      }

      const instance = await createTerminalInstance(paneId, defaultShell, workspaceCwd);
      instance.isBooted = true;
      markAgentStarting(paneId);

      const bootCommand = buildBootCommand(config);
      if (!bootCommand) throw new Error('Agent CLI command is empty.');
      await electronAPI.writePty(paneId, bootCommand + '\r');
      await waitForAgentProcess(paneId);

      const hasCommandLinePrompt = (
        (bootCommand.includes('-s') || bootCommand.includes('--system')) &&
        config.promptPath
      );
      const helperCommand = await electronAPI.getAgentHelperCommand();
      const routes = getRoutingConnections();
      const allowedRoutes = Object.keys(routes).length > 0
        ? routes[paneId] || []
        : Object.keys(agentConfigs).filter((candidate) => candidate !== paneId);
      const prompt = [
        generateAgentPromptContract({
          paneId,
          role: config.agentName,
          allowedRoutes,
          capabilities: normalizeCapabilities(config.capabilities?.length ? config.capabilities : DEFAULT_AGENT_CAPABILITIES),
          tools: normalizeCapabilities(config.tools),
          roleInstructions: !hasCommandLinePrompt ? config.promptContent : undefined,
          helperCommand,
        }),
      ].join('\n\n');
      const payload = `\x1b[200~${prompt}\x1b[201~\r`;
      await electronAPI.writePty(paneId, payload);
    } catch (error) {
      const description = error instanceof Error ? error.message : String(error);
      markAgentFailed(paneId, description);
      console.error(`Failed to boot ${paneId}:`, error);
    } finally {
      bootingAgents.current.delete(paneId);
    }
  };

  // Configured agents exist independently of the visible terminal tab.
  useEffect(() => {
    if (!defaultShell) return;
    Object.keys(agentConfigs).forEach((paneId) => {
      registerAgent(paneId, {
        role: agentConfigs[paneId].agentName,
        capabilities: agentConfigs[paneId].capabilities?.length
          ? agentConfigs[paneId].capabilities
          : DEFAULT_AGENT_CAPABILITIES,
        tools: agentConfigs[paneId].tools || [],
        promptVersion: AGENT_PROMPT_VERSION,
      });
      void createTerminalInstance(paneId, defaultShell, workspaceCwd).then((instance) => {
        if (!instance.isBooted) {
          instance.isBooted = true;
          void handleBootPane(paneId, agentConfigs[paneId]);
        }
      }).catch((error) => {
        markAgentFailed(paneId, error instanceof Error ? error.message : String(error));
      });
    });
  }, [agentConfigs, defaultShell, workspaceCwd]);

  useEffect(() => {
    const unsubscribe = subscribeToTerminalExit((paneId, info) => {
      if (getTerminalInstance(paneId)) {
        markAgentFailed(paneId, `PTY exited with code ${info.exitCode}.`);
      }
    });
    const interval = window.setInterval(() => checkAgentHealth(), HEALTH_CHECK_MS);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
    };
  }, []);

  // Add agent callback from sidebar modal
  const handleAddAgent = (paneId: string, config: AgentConfig, spawnPane: boolean) => {
    let targetId: string | null = paneId;
    
    if (spawnPane) {
      targetId = handleSplit();
      if (!targetId) return; // grid at capacity
    }

    const nextConfigs = {
      ...agentConfigs,
      [targetId]: {
        ...config,
        paneId: targetId,
      },
    };

    setAgentConfigs(nextConfigs);
    saveWorkspace(spawnPane ? [...paneIds, targetId] : paneIds, targetId, nextConfigs);

  };

  // Extract agent names to display inside connection list helper
  const getAgentNamesMap = () => {
    const names: Record<string, string> = {};
    Object.keys(agentConfigs).forEach((pid) => {
      names[pid] = agentConfigs[pid]?.agentName || '';
    });
    return names;
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        background: 'transparent',
        overflow: 'hidden',
      }}
    >
      {/* Frameless spacing header for macOS titlebar draggable */}
      <div className="titlebar-spacer" style={{ WebkitAppRegion: 'drag' } as any}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Star size={11} fill="var(--accent-cyan)" stroke="var(--accent-cyan)" />
          <span>lightfold grid // mixed-model teams</span>
        </div>
      </div>

      {/* Main Container Layout */}
      <div className="layout-container" style={{ flex: 1 }}>
        
        {/* Left Sidebar */}
        <div className="sidebar">
          {/* Header controls inside sidebar */}
          <div style={{ padding: '16px', borderBottom: '1px solid var(--panel-border)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Project Root selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
              <Folder size={14} style={{ color: 'var(--accent-cyan)' }} />
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                PROJECT ROOT CWD
              </span>
            </div>
            
            <button
              onClick={handleSelectWorkspaceDirectory}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: '8px',
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--glass-border)',
                color: workspaceCwd ? '#fff' : 'var(--text-muted)',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'left',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                transition: 'all 0.2s',
              }}
              title={workspaceCwd || "Select project root directory for shell terminals"}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)')}
            >
              <FolderOpen size={12} style={{ color: workspaceCwd ? 'var(--accent-cyan)' : 'var(--text-dark)', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                {workspaceCwd ? workspaceCwd.split('/').pop() || workspaceCwd : 'Choose project root...'}
              </span>
            </button>

            <button
              onClick={handleCreateDemoProject}
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '7px',
                border: '1px solid rgba(0,240,255,0.12)',
                background: 'rgba(0,240,255,0.04)',
                color: 'var(--accent-cyan)',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Create Demo Project
            </button>

            <div style={{ margin: '4px 0', borderTop: '1px solid var(--panel-border)' }} />

            <button
              onClick={() => setShowWorkspacePresets(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                width: '100%',
                padding: '9px 12px',
                borderRadius: '8px',
                border: '1px solid rgba(0, 240, 255, 0.18)',
                background: 'linear-gradient(135deg, rgba(0,240,255,0.12), rgba(168,85,247,0.1))',
                color: '#fff',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <Sparkles size={13} style={{ color: 'var(--accent-cyan)' }} />
              Start With Preset
            </button>

            <div style={{ margin: '4px 0', borderTop: '1px solid var(--panel-border)' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <Layout size={14} style={{ color: 'var(--accent-cyan)' }} />
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                WORKSPACE TERMINALS
              </span>
            </div>

            {/* Tab controls */}
            <button
              onClick={() => handleSplit()}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: 'none',
                background: 'rgba(255, 255, 255, 0.04)',
                color: 'var(--text-main)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)')}
            >
              <Plus size={13} style={{ color: 'var(--accent-cyan)' }} />
              + New Terminal Tab
            </button>

            {/* New Add Agent Button */}
            <button
              onClick={() => setShowAddAgent(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: 'none',
                background: 'rgba(0, 240, 255, 0.05)',
                outline: '1px solid rgba(0, 240, 255, 0.1)',
                color: '#fff',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0, 240, 255, 0.15)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(0, 240, 255, 0.05)')}
            >
              <Plus size={13} style={{ color: 'var(--accent-cyan)' }} />
              Add Agent
            </button>

            {/* New Add Connection Button */}
            <button
              onClick={() => setShowAddConnection(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: 'none',
                background: 'rgba(168, 85, 247, 0.05)',
                outline: '1px solid rgba(168, 85, 247, 0.1)',
                color: '#fff',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(168, 85, 247, 0.15)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(168, 85, 247, 0.05)')}
            >
              <Link2 size={13} style={{ color: 'var(--accent-purple)' }} />
              Add Connection
            </button>

            {/* Settings button */}
            <button
              onClick={() => setShowSettings(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: 'none',
                background: 'rgba(255, 255, 255, 0.04)',
                color: 'var(--text-main)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)')}
            >
              <Sliders size={13} style={{ color: 'var(--text-muted)' }} />
              Configure Grid
            </button>

            {/* Separator / Spacer */}
            <div style={{ margin: '8px 0', borderTop: '1px solid var(--panel-border)' }} />

            {/* Profile Configurations Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <Save size={14} style={{ color: 'var(--accent-cyan)' }} />
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                WORKSPACE PROFILES
              </span>
            </div>

            {/* Save Workspace Profile As... */}
            <button
              onClick={handleSaveWorkspaceFile}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: 'none',
                background: 'rgba(0, 240, 255, 0.05)',
                outline: '1px solid rgba(0, 240, 255, 0.1)',
                color: '#fff',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0, 240, 255, 0.15)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(0, 240, 255, 0.05)')}
            >
              <Save size={13} style={{ color: 'var(--accent-cyan)' }} />
              Save Profile As...
            </button>

            {/* Load Workspace Profile */}
            <button
              onClick={handleLoadWorkspaceFile}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: 'none',
                background: 'rgba(255, 255, 255, 0.04)',
                color: 'var(--text-main)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)')}
            >
              <FolderOpen size={13} style={{ color: 'var(--text-muted)' }} />
              Load Profile File
            </button>
          </div>


        </div>

        {/* Center Workspace (Tabbed Terminals) */}
        <div className="workspace-center">
          <TerminalGrid
            paneIds={paneIds}
            activePaneId={activePaneId}
            shellPath={defaultShell}
            cwd={workspaceCwd}
            agentConfigs={agentConfigs}
            onSelectPane={setActivePaneId}
            onClosePane={handleClosePane}
            onBootPane={(paneId) => void handleBootPane(paneId, undefined, true)}
            onAddPane={() => handleSplit()}
          />
        </div>

        {/* Collapsible Right Panel Drawer for Broker sequence diagrams */}
        <div
          style={{
            display: 'flex',
            height: '100%',
            transition: 'width 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            width: isRightPanelOpen ? '320px' : '0px',
            position: 'relative',
          }}
        >
          {/* Collapse Handle Button */}
          <button
            onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
            style={{
              position: 'absolute',
              top: '50%',
              left: '-16px',
              transform: 'translateY(-50%)',
              width: '16px',
              height: '48px',
              borderRadius: '6px 0 0 6px',
              background: 'rgba(15, 23, 42, 0.8)',
              border: '1px solid var(--panel-border)',
              borderRight: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              outline: 'none',
            }}
          >
            {isRightPanelOpen ? <ChevronRight size={10} /> : <ChevronLeft size={10} />}
          </button>

          {/* Drawer content */}
          {isRightPanelOpen && (
            <div style={{ width: '320px', height: '100%' }}>
              <CentralBroker paneIds={paneIds} workspaceRoot={workspaceCwd} agentConfigs={agentConfigs} />
            </div>
          )}
        </div>
      </div>

      {/* Global MODAL overlays */}
      <ApprovalOverlay />
      
      {showSettings && (
        <SettingsModal
          paneIds={paneIds}
          agentConfigs={agentConfigs}
          onSaveAgentConfigs={handleSaveAgentConfigs}
          onClose={() => setShowSettings(false)}
          currentShell={defaultShell}
          onSelectShell={handleSelectShell}
        />
      )}

      {showAddAgent && (
        <AddAgentModal
          paneIds={paneIds}
          onAddAgent={handleAddAgent}
          onClose={() => setShowAddAgent(false)}
        />
      )}

      {showAddConnection && (
        <AddConnectionModal
          paneIds={paneIds}
          connections={getRoutingConnections()}
          onSaveConnections={handleSaveConnections}
          onClose={() => setShowAddConnection(false)}
          agentNames={getAgentNamesMap()}
        />
      )}

      {showWorkspacePresets && (
        <WorkspacePresetModal
          onApply={handleApplyWorkspacePreset}
          onClose={() => setShowWorkspacePresets(false)}
        />
      )}
    </div>
  );
}
