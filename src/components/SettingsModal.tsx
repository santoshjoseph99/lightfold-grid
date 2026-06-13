import React, { useState, useEffect } from 'react';
import { Settings, Check, X, ShieldAlert, Cpu, Network, FileText, UploadCloud, Terminal } from 'lucide-react';
import { getAutopilot, setAutopilot, getBlocklist, setBlocklist, getTrustedCommands, setTrustedCommands, getRoutingConnections, setRoutingConnections, getReliabilitySettings, setReliabilitySettings, getBrokerRetentionLimit, setBrokerRetentionLimit } from '../services/brokerProtocol';

export interface AgentConfig {
  paneId: string;
  agentName: string;
  cliCommand: string;
  selectedModel: string;
  promptPath: string;
  promptContent: string;
  capabilities: string[];
  tools: string[];
  yoloMode: boolean;
}

interface SettingsModalProps {
  paneIds: string[];
  agentConfigs: Record<string, AgentConfig>;
  onSaveAgentConfigs: (configs: Record<string, AgentConfig>) => void;
  onClose: () => void;
  currentShell: string;
  onSelectShell: (shellPath: string) => void;
}

interface ShellItem {
  name: string;
  path: string;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  paneIds,
  agentConfigs,
  onSaveAgentConfigs,
  onClose,
  currentShell,
  onSelectShell,
}) => {
  const [activeTab, setActiveTab] = useState<'agents' | 'routing' | 'general'>('agents');
  
  // Shell configurations
  const [shells, setShells] = useState<ShellItem[]>([]);
  
  // General configurations states
  const [autopilot, setAutopilotVal] = useState(getAutopilot());
  const [blocklistInput, setBlocklistInput] = useState(getBlocklist().join(', '));
  const [trustedInput, setTrustedInput] = useState(getTrustedCommands().join(', '));
  const [reliabilitySettings, setLocalReliabilitySettings] = useState(() => getReliabilitySettings());
  const [retentionLimit, setRetentionLimit] = useState(() => getBrokerRetentionLimit());
  
  // Agent profile configurations states
  const [localAgentConfigs, setLocalAgentConfigs] = useState<Record<string, AgentConfig>>(() => {
    // Populate default empty configs for active panes if not already configured
    const initial: Record<string, AgentConfig> = { ...agentConfigs };
    paneIds.forEach((id) => {
      if (!initial[id]) {
        initial[id] = {
          paneId: id,
          agentName: id === 'Pane-A' ? 'Orchestrator' : `Agent-${id.replace('Pane-', '')}`,
          cliCommand: 'echo "Booting agent..."',
          selectedModel: 'auto',
          promptPath: '',
          promptContent: '',
          capabilities: ['general'],
          tools: [],
          yoloMode: false,
        };
      }
    });
    return initial;
  });
  
  const [selectedConfigPaneId, setSelectedConfigPaneId] = useState<string>(paneIds[0] || 'Pane-A');

  // Routing matrix state
  // key = sender pane ID, value = list of receiver pane IDs allowed to receive
  const [localConnections, setLocalConnections] = useState<Record<string, string[]>>(() => {
    const activeConns = { ...getRoutingConnections() };
    // If matrix connections list is empty, initialize all splits connected in a Mesh pattern
    paneIds.forEach((src) => {
      if (!activeConns[src]) {
        activeConns[src] = paneIds.filter((dest) => dest !== src);
      }
    });
    return activeConns;
  });

  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    electronAPI.getAvailableShells().then((res: ShellItem[]) => {
      setShells(res);
    });
  }, []);

  const handleSelectPromptFile = async () => {
    const electronAPI = (window as any).electronAPI;
    const fileData = await electronAPI.selectPromptFile();
    if (fileData) {
      setLocalAgentConfigs({
        ...localAgentConfigs,
        [selectedConfigPaneId]: {
          ...localAgentConfigs[selectedConfigPaneId],
          promptPath: fileData.path,
          promptContent: fileData.content,
        },
      });
    }
  };

  const handleMatrixToggle = (sender: string, receiver: string) => {
    const currentTargets = localConnections[sender] || [];
    let updatedTargets: string[];
    
    if (currentTargets.includes(receiver)) {
      updatedTargets = currentTargets.filter((t) => t !== receiver);
    } else {
      updatedTargets = [...currentTargets, receiver];
    }

    setLocalConnections({
      ...localConnections,
      [sender]: updatedTargets,
    });
  };

  const handleSave = () => {
    // Save General
    setAutopilot(autopilot);
    setBlocklist(blocklistInput.split(',').map((x) => x.trim()).filter((x) => x.length > 0));
    setTrustedCommands(trustedInput.split(',').map((x) => x.trim()).filter((x) => x.length > 0));
    setReliabilitySettings(reliabilitySettings);
    setBrokerRetentionLimit(retentionLimit);

    // Save Matrix
    setRoutingConnections(localConnections);

    // Save Agent configs
    onSaveAgentConfigs(localAgentConfigs);
    
    onClose();
  };

  const currentAgent = localAgentConfigs[selectedConfigPaneId] || {
    paneId: selectedConfigPaneId,
    agentName: '',
    cliCommand: '',
    selectedModel: '',
    promptPath: '',
    promptContent: '',
    capabilities: ['general'],
    tools: [],
    yoloMode: false,
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(5, 8, 16, 0.45)',
        backdropFilter: 'blur(8px)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        animation: 'fadeIn 0.2s ease',
      }}
    >
      <div
        className="glass-panel animate-slideup"
        style={{
          width: '100%',
          maxWidth: '560px',
          height: '90%',
          maxHeight: '650px',
          background: 'rgba(15, 23, 42, 0.9)',
          border: '1px solid var(--panel-border)',
          padding: '24px',
          borderRadius: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        {/* Modal Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px' }}>
          <Settings size={18} style={{ color: 'var(--accent-purple)' }} />
          <span style={{ fontWeight: 700, fontSize: '15px', letterSpacing: '0.05em' }}>WORKSPACE SETTINGS</span>
        </div>

        {/* Tab Buttons bar */}
        <div style={{ display: 'flex', gap: '4px', background: 'rgba(255, 255, 255, 0.03)', padding: '4px', borderRadius: '8px' }}>
          <button
            onClick={() => setActiveTab('agents')}
            style={{
              flex: 1,
              padding: '6px 0',
              border: 'none',
              borderRadius: '6px',
              background: activeTab === 'agents' ? 'var(--accent-purple)' : 'transparent',
              color: activeTab === 'agents' ? '#fff' : 'var(--text-muted)',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <Cpu size={12} />
            AGENT PROFILE
          </button>
          <button
            onClick={() => setActiveTab('routing')}
            style={{
              flex: 1,
              padding: '6px 0',
              border: 'none',
              borderRadius: '6px',
              background: activeTab === 'routing' ? 'var(--accent-purple)' : 'transparent',
              color: activeTab === 'routing' ? '#fff' : 'var(--text-muted)',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <Network size={12} />
            ROUTING GRAPH
          </button>
          <button
            onClick={() => setActiveTab('general')}
            style={{
              flex: 1,
              padding: '6px 0',
              border: 'none',
              borderRadius: '6px',
              background: activeTab === 'general' ? 'var(--accent-purple)' : 'transparent',
              color: activeTab === 'general' ? '#fff' : 'var(--text-muted)',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <Terminal size={12} />
            GENERAL
          </button>
        </div>

        {/* Tab contents panel */}
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
          {activeTab === 'agents' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Select Shell pane to edit */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  TARGET WORKSPACE PANE
                </label>
                <select
                  value={selectedConfigPaneId}
                  onChange={(e) => setSelectedConfigPaneId(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.4)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '8px',
                    padding: '10px',
                    color: '#fff',
                    outline: 'none',
                    fontSize: '12px',
                  }}
                >
                  {paneIds.map((pid) => (
                    <option key={pid} value={pid} style={{ background: '#0f172a' }}>
                      {pid} {localAgentConfigs[pid]?.agentName ? `(${localAgentConfigs[pid].agentName})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Agent Settings Form */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  background: 'rgba(255, 255, 255, 0.01)',
                  padding: '14px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.03)',
                }}
              >
                <div>
                  <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    AGENT NAME
                  </label>
                  <input
                    type="text"
                    value={currentAgent.agentName}
                    onChange={(e) => setLocalAgentConfigs({
                      ...localAgentConfigs,
                      [selectedConfigPaneId]: { ...currentAgent, agentName: e.target.value }
                    })}
                    style={{
                      width: '100%',
                      background: 'rgba(0,0,0,0.3)',
                      border: '1px solid var(--glass-border)',
                      borderRadius: '6px',
                      padding: '8px',
                      color: '#fff',
                      fontSize: '12px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    TOOLS (COMMA-SEPARATED)
                  </label>
                  <input
                    type="text"
                    placeholder="git, npm, docker"
                    value={(currentAgent.tools || []).join(', ')}
                    onChange={(e) => setLocalAgentConfigs({
                      ...localAgentConfigs,
                      [selectedConfigPaneId]: {
                        ...currentAgent,
                        tools: e.target.value.split(',').map((value) => value.trim()).filter(Boolean),
                      }
                    })}
                    style={{
                      width: '100%',
                      background: 'rgba(0,0,0,0.3)',
                      border: '1px solid var(--glass-border)',
                      borderRadius: '6px',
                      padding: '8px',
                      color: '#fff',
                      fontSize: '12px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                    CAPABILITIES (COMMA-SEPARATED)
                  </label>
                  <input
                    type="text"
                    placeholder="general, coding, testing"
                    value={(currentAgent.capabilities || []).join(', ')}
                    onChange={(e) => setLocalAgentConfigs({
                      ...localAgentConfigs,
                      [selectedConfigPaneId]: {
                        ...currentAgent,
                        capabilities: e.target.value.split(',').map((value) => value.trim()).filter(Boolean),
                      }
                    })}
                    style={{
                      width: '100%',
                      background: 'rgba(0,0,0,0.3)',
                      border: '1px solid var(--glass-border)',
                      borderRadius: '6px',
                      padding: '8px',
                      color: '#fff',
                      fontSize: '12px',
                      outline: 'none',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                      CLI MODEL NAME
                    </label>
                    <input
                      type="text"
                      placeholder="gemini-1.5-pro"
                      value={currentAgent.selectedModel}
                      onChange={(e) => setLocalAgentConfigs({
                        ...localAgentConfigs,
                        [selectedConfigPaneId]: { ...currentAgent, selectedModel: e.target.value }
                      })}
                      style={{
                        width: '100%',
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: '6px',
                        padding: '8px',
                        color: '#fff',
                        fontSize: '12px',
                        outline: 'none',
                      }}
                    />
                  </div>

                  <div style={{ flex: 1.5 }}>
                    <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                      CLI LAUNCH COMMAND
                    </label>
                    <input
                      type="text"
                      placeholder="gemini-cli run"
                      value={currentAgent.cliCommand}
                      onChange={(e) => setLocalAgentConfigs({
                        ...localAgentConfigs,
                        [selectedConfigPaneId]: { ...currentAgent, cliCommand: e.target.value }
                      })}
                      style={{
                        width: '100%',
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid var(--glass-border)',
                        borderRadius: '6px',
                        padding: '8px',
                        color: '#fff',
                        fontSize: '12px',
                        outline: 'none',
                      }}
                    />
                  </div>
                </div>

                {/* Sourcing files for prompts */}
                <div>
                  <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                    SYSTEM PROMPT INSTRUCTION (MARKDOWN)
                  </label>
                  
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      onClick={handleSelectPromptFile}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: 'none',
                        background: 'rgba(0, 240, 255, 0.1)',
                        color: 'var(--accent-cyan)',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0, 240, 255, 0.15)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(0, 240, 255, 0.1)')}
                    >
                      <UploadCloud size={12} />
                      Splat Prompt File
                    </button>
                    
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {currentAgent.promptPath ? currentAgent.promptPath.split('/').pop() : 'No file selected (defaults to empty prompt)'}
                    </span>
                  </div>

                  {/* YOLO Mode toggle */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'rgba(255, 255, 255, 0.02)',
                      padding: '10px',
                      borderRadius: '6px',
                      border: '1px solid rgba(255,255,255,0.03)',
                      marginTop: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Cpu size={14} style={{ color: currentAgent.yoloMode ? 'var(--accent-orange)' : 'var(--text-muted)' }} />
                      <div>
                        <span style={{ fontSize: '11px', fontWeight: 600, display: 'block' }}>Agent YOLO Mode</span>
                        <span style={{ fontSize: '9px', color: 'var(--text-dark)' }}>Automatically accept all agent tool requests (skip confirmation)</span>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={currentAgent.yoloMode || false}
                      onChange={(e) => setLocalAgentConfigs({
                        ...localAgentConfigs,
                        [selectedConfigPaneId]: { ...currentAgent, yoloMode: e.target.checked }
                      })}
                      style={{
                        width: '16px',
                        height: '16px',
                        cursor: 'pointer',
                        accentColor: 'var(--accent-orange)',
                      }}
                    />
                  </div>

                  {currentAgent.promptContent && (
                    <div style={{ marginTop: '10px' }}>
                      <label style={{ display: 'block', fontSize: '9px', fontWeight: 600, color: 'var(--text-dark)', marginBottom: '4px' }}>
                        PROMPT PREVIEW
                      </label>
                      <div
                        style={{
                          background: 'rgba(0,0,0,0.4)',
                          borderRadius: '6px',
                          padding: '8px',
                          maxHeight: '100px',
                          overflowY: 'auto',
                          fontSize: '10px',
                          fontFamily: 'var(--font-mono)',
                          color: '#a7f3d0',
                          border: '1px solid rgba(255,255,255,0.02)',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {currentAgent.promptContent}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'routing' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(259, 115, 22, 0.04)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(249, 115, 22, 0.08)' }}>
                <Network size={14} style={{ color: 'var(--accent-orange)' }} />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                  Determine connection routes. Rows represent the **Sender** agent, columns represent the allowed **Receiver** agents. Check a box to link them.
                </span>
              </div>

              {/* Grid checkbox connection matrix */}
              <div style={{ overflowX: 'auto', marginTop: '4px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '8px', borderBottom: '1px solid var(--panel-border)', textAlign: 'left', color: 'var(--text-dark)' }}>
                        Sender ➔ Recv
                      </th>
                      {paneIds.map((id) => (
                        <th key={id} style={{ padding: '8px', borderBottom: '1px solid var(--panel-border)', textAlign: 'center', color: 'var(--accent-cyan)' }}>
                          {id}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paneIds.map((srcId) => (
                      <tr key={srcId}>
                        <td style={{ padding: '10px 8px', borderBottom: '1px solid var(--panel-border)', fontWeight: 600, color: 'var(--text-main)' }}>
                          {srcId} <span style={{ fontSize: '9px', fontWeight: 'normal', color: 'var(--text-muted)' }}>({localAgentConfigs[srcId]?.agentName || 'CLI'})</span>
                        </td>
                        {paneIds.map((destId) => {
                          const isSelf = srcId === destId;
                          const isChecked = (localConnections[srcId] || []).includes(destId);
                          
                          return (
                            <td key={destId} style={{ padding: '10px 8px', borderBottom: '1px solid var(--panel-border)', textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                disabled={isSelf}
                                checked={!isSelf && isChecked}
                                onChange={() => handleMatrixToggle(srcId, destId)}
                                style={{
                                  width: '16px',
                                  height: '16px',
                                  cursor: isSelf ? 'not-allowed' : 'pointer',
                                  accentColor: 'var(--accent-purple)',
                                  opacity: isSelf ? 0.1 : 1,
                                }}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'general' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Shell select option */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  DEFAULT SYSTEM SHELL
                </label>
                <select
                  value={currentShell}
                  onChange={(e) => onSelectShell(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.4)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '8px',
                    padding: '10px',
                    color: '#fff',
                    outline: 'none',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  {shells.map((sh, idx) => (
                    <option key={idx} value={sh.path} style={{ background: '#0f172a' }}>
                      {sh.name} ({sh.path})
                    </option>
                  ))}
                </select>
              </div>

              {/* Autopilot toggle */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'rgba(255, 255, 255, 0.02)',
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.04)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Cpu size={16} style={{ color: autopilot ? 'var(--accent-cyan)' : 'var(--text-muted)' }} />
                  <div>
                    <span style={{ fontSize: '12px', fontWeight: 600, display: 'block' }}>Autopilot Execution</span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Automatically inject commands without approval gates</span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={autopilot}
                  onChange={(e) => setAutopilotVal(e.target.checked)}
                  style={{
                    width: '18px',
                    height: '18px',
                    cursor: 'pointer',
                    accentColor: 'var(--accent-cyan)',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  DURABLE BROKER RETENTION
                </label>
                <input
                  type="number"
                  min="100"
                  value={retentionLimit}
                  onChange={(e) => setRetentionLimit(Math.max(100, Number(e.target.value) || 100))}
                  style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.4)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '6px',
                    padding: '7px',
                    color: '#fff',
                    fontSize: '11px',
                    outline: 'none',
                  }}
                />
                <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                  Maximum completed messages and audit events retained in SQLite.
                </span>
              </div>

              {/* Command Blocklist */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  RELIABLE DELIVERY
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {[
                    { key: 'acknowledgementTimeoutMs', label: 'ACK TIMEOUT (MS)' },
                    { key: 'completionTimeoutMs', label: 'COMPLETION TIMEOUT (MS)' },
                    { key: 'maxAttempts', label: 'MAX ATTEMPTS' },
                    { key: 'retryBaseDelayMs', label: 'RETRY BASE DELAY (MS)' },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <label style={{ display: 'block', fontSize: '9px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                        {label}
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={reliabilitySettings[key as keyof typeof reliabilitySettings]}
                        onChange={(e) => setLocalReliabilitySettings({
                          ...reliabilitySettings,
                          [key]: Math.max(1, Number(e.target.value) || 1),
                        })}
                        style={{
                          width: '100%',
                          background: 'rgba(0,0,0,0.4)',
                          border: '1px solid var(--glass-border)',
                          borderRadius: '6px',
                          padding: '7px',
                          color: '#fff',
                          fontSize: '11px',
                          outline: 'none',
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Command Blocklist */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                  <ShieldAlert size={14} style={{ color: 'var(--accent-red)' }} />
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>
                    COMMAND BLOCKLIST (COMMA SEPARATED)
                  </label>
                </div>
                <textarea
                  value={blocklistInput}
                  onChange={(e) => setBlocklistInput(e.target.value)}
                  style={{
                    width: '100%',
                    height: '50px',
                    background: 'rgba(0,0,0,0.4)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '8px',
                    padding: '8px',
                    color: '#fff',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    resize: 'none',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Trusted list */}
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  AUTO-APPROVED TRUSTED LIST (COMMA SEPARATED)
                </label>
                <textarea
                  value={trustedInput}
                  onChange={(e) => setTrustedInput(e.target.value)}
                  style={{
                    width: '100%',
                    height: '50px',
                    background: 'rgba(0,0,0,0.4)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '8px',
                    padding: '8px',
                    color: '#fff',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    resize: 'none',
                    outline: 'none',
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer actions controls */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '1px solid var(--panel-border)', paddingTop: '12px', marginTop: '4px' }}>
          <button
            onClick={onClose}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '6px 14px',
              borderRadius: '6px',
              border: 'none',
              background: 'rgba(255,255,255,0.04)',
              color: 'var(--text-main)',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <X size={12} />
            Cancel
          </button>
          
          <button
            onClick={handleSave}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '6px 16px',
              borderRadius: '6px',
              border: 'none',
              background: 'var(--accent-purple)',
              color: '#fff',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <Check size={12} />
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
};
