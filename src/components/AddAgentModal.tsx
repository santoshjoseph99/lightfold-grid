import React, { useState } from 'react';
import { Cpu, UploadCloud, X, Check, Sparkles } from 'lucide-react';
import { AgentConfig } from './SettingsModal';

interface AddAgentModalProps {
  paneIds: string[];
  onAddAgent: (paneId: string, config: AgentConfig, spawnPane: boolean) => void;
  onClose: () => void;
}

export const AddAgentModal: React.FC<AddAgentModalProps> = ({
  paneIds,
  onAddAgent,
  onClose,
}) => {
  const [selectedPreset, setSelectedPreset] = useState<'gemini' | 'copilot' | 'ollama' | 'custom'>('gemini');
  const [agentName, setAgentName] = useState('Gemini-Agent');
  const [cliCommand, setCliCommand] = useState('gemini');
  const [selectedModel, setSelectedModel] = useState('gemini-1.5-pro');
  const [promptPath, setPromptPath] = useState('');
  const [promptContent, setPromptContent] = useState('');
  const [yoloMode, setYoloMode] = useState(false);
  
  // Target pane selection. If 'new', will spawn split pane
  const [targetPane, setTargetPane] = useState<string>(paneIds[0] || 'new');

  const handlePresetChange = (preset: 'gemini' | 'copilot' | 'ollama' | 'custom') => {
    setSelectedPreset(preset);
    if (preset === 'gemini') {
      setAgentName('Gemini-Agent');
      setCliCommand('gemini');
      setSelectedModel('auto');
    } else if (preset === 'copilot') {
      setAgentName('Copilot-Agent');
      setCliCommand('copilot');
      setSelectedModel('gpt-4o');
    } else if (preset === 'ollama') {
      setAgentName('Gemma-Agent');
      setCliCommand('ollama run');
      setSelectedModel('gemma2');
    } else {
      setAgentName('Custom-Agent');
      setCliCommand('echo "Running..."');
      setSelectedModel('custom-model');
    }
  };

  const handleSelectPromptFile = async () => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI) {
      const fileData = await electronAPI.selectPromptFile();
      if (fileData) {
        setPromptPath(fileData.path);
        setPromptContent(fileData.content);
      }
    }
  };

  const handleSubmit = () => {
    const config: AgentConfig = {
      paneId: targetPane === 'new' ? '' : targetPane, // Will be assigned by parent App if 'new'
      agentName,
      cliCommand,
      selectedModel,
      promptPath,
      promptContent,
      yoloMode,
    };
    onAddAgent(targetPane, config, targetPane === 'new');
    onClose();
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
          maxWidth: '480px',
          background: 'rgba(15, 23, 42, 0.9)',
          border: '1px solid var(--panel-border)',
          padding: '24px',
          borderRadius: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px' }}>
          <Cpu size={18} style={{ color: 'var(--accent-cyan)' }} />
          <span style={{ fontWeight: 700, fontSize: '15px', letterSpacing: '0.05em' }}>ADD AGENT PROFILE</span>
        </div>

        {/* Preset selector */}
        <div>
          <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
            AGENT CLI PRESETS
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {['gemini', 'copilot', 'ollama', 'custom'].map((preset) => (
              <button
                key={preset}
                onClick={() => handlePresetChange(preset as any)}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  borderRadius: '6px',
                  border: '1px solid',
                  borderColor: selectedPreset === preset ? 'var(--accent-cyan)' : 'var(--glass-border)',
                  background: selectedPreset === preset ? 'rgba(0, 240, 255, 0.08)' : 'rgba(255,255,255,0.01)',
                  color: selectedPreset === preset ? '#fff' : 'var(--text-muted)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  transition: 'all 0.2s',
                }}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* Form fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          
          <div style={{ display: 'flex', gap: '10px' }}>
            {/* Name */}
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                AGENT NAME
              </label>
              <input
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
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
            {/* Target Shell */}
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                TARGET SHELL PANE
              </label>
              <select
                value={targetPane}
                onChange={(e) => setTargetPane(e.target.value)}
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
              >
                {paneIds.map((pid) => (
                  <option key={pid} value={pid} style={{ background: '#0f172a' }}>
                    {pid}
                  </option>
                ))}
                {paneIds.length < 30 && (
                  <option value="new" style={{ background: '#0f172a', color: 'var(--accent-cyan)' }}>
                    + Spawn New Tab
                  </option>
                )}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            {/* Model */}
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                MODEL
              </label>
              <input
                type="text"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
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
            {/* Launch Command */}
            <div style={{ flex: 1.2 }}>
              <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                CLI EXECUTION CMD
              </label>
              <input
                type="text"
                value={cliCommand}
                onChange={(e) => setCliCommand(e.target.value)}
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
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Cpu size={14} style={{ color: yoloMode ? 'var(--accent-cyan)' : 'var(--text-muted)' }} />
              <div>
                <span style={{ fontSize: '11px', fontWeight: 600, display: 'block' }}>Agent YOLO Mode</span>
                <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Automatically accept all agent tool requests (skip confirmation)</span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={yoloMode}
              onChange={(e) => setYoloMode(e.target.checked)}
              style={{
                width: '16px',
                height: '16px',
                cursor: 'pointer',
                accentColor: 'var(--accent-cyan)',
              }}
            />
          </div>

          {/* Sourcing files for prompts */}
          <div>
            <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
              PROMPT INSTRUCTIONS FILE
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
                }}
              >
                <UploadCloud size={12} />
                Load Prompt
              </button>
              
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {promptPath ? promptPath.split('/').pop() : 'No file selected'}
              </span>
            </div>

            {promptContent && (
              <div
                style={{
                  marginTop: '8px',
                  background: 'rgba(0,0,0,0.4)',
                  borderRadius: '6px',
                  padding: '8px',
                  maxHeight: '70px',
                  overflowY: 'auto',
                  fontSize: '10px',
                  fontFamily: 'var(--font-mono)',
                  color: '#a7f3d0',
                  border: '1px solid rgba(255,255,255,0.02)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {promptContent}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--panel-border)', paddingTop: '12px', marginTop: '4px' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            Saves to starlight-workspace.json
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
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
              onClick={handleSubmit}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '6px 16px',
                borderRadius: '6px',
                border: 'none',
                background: 'var(--accent-cyan)',
                color: '#030712',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <Check size={12} />
              Add Agent
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
