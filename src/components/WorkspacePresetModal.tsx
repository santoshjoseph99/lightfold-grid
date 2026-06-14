import React, { useState } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import {
  buildWorkspacePreset,
  PROVIDER_PRESETS,
  ProviderPresetId,
  TOPOLOGY_PRESETS,
  TopologyPresetId,
  WorkspacePreset,
} from '../services/workspacePresets';

interface WorkspacePresetModalProps {
  onApply: (preset: WorkspacePreset) => void;
  onClose: () => void;
}

export const WorkspacePresetModal: React.FC<WorkspacePresetModalProps> = ({ onApply, onClose }) => {
  const [provider, setProvider] = useState<ProviderPresetId>('ollama');
  const [topology, setTopology] = useState<TopologyPresetId>('wheel');
  const [model, setModel] = useState(PROVIDER_PRESETS.ollama.defaultModel);
  const [customCommand, setCustomCommand] = useState('');

  const selectProvider = (next: ProviderPresetId) => {
    setProvider(next);
    setModel(PROVIDER_PRESETS[next].defaultModel);
  };

  const apply = () => {
    if (provider === 'custom' && !customCommand.trim()) {
      window.alert('Enter a custom CLI command before applying this preset.');
      return;
    }
    if (!window.confirm('Replace the current agent grid with this preset? Running agent terminals will restart.')) return;
    onApply(buildWorkspacePreset({ provider, topology, model, customCommand }));
    onClose();
  };

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    background: 'rgba(0,0,0,0.35)',
    border: '1px solid var(--glass-border)',
    borderRadius: '7px',
    padding: '9px',
    color: '#fff',
    fontSize: '12px',
    outline: 'none',
  };

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(5,8,16,0.55)', backdropFilter: 'blur(8px)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div className="glass-panel animate-slideup" style={{ width: '100%', maxWidth: '520px', background: 'rgba(15,23,42,0.96)', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px' }}>
          <Sparkles size={18} style={{ color: 'var(--accent-cyan)' }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: '15px' }}>START WITH A PRESET</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '10px', marginTop: '2px' }}>Safe defaults, embedded role prompts, and explicit routes.</div>
          </div>
        </div>

        <label style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>
          PROVIDER
          <select value={provider} onChange={(event) => selectProvider(event.target.value as ProviderPresetId)} style={{ ...fieldStyle, marginTop: '5px' }}>
            {Object.entries(PROVIDER_PRESETS).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
          </select>
        </label>

        <label style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>
          TOPOLOGY
          <select value={topology} onChange={(event) => setTopology(event.target.value as TopologyPresetId)} style={{ ...fieldStyle, marginTop: '5px' }}>
            {Object.entries(TOPOLOGY_PRESETS).map(([id, item]) => <option key={id} value={id}>{item.label}: {item.roles.join(' -> ')}</option>)}
          </select>
        </label>

        <label style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>
          MODEL
          <input value={model} onChange={(event) => setModel(event.target.value)} style={{ ...fieldStyle, marginTop: '5px' }} />
        </label>

        {provider === 'custom' && (
          <label style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700 }}>
            CLI COMMAND
            <input value={customCommand} onChange={(event) => setCustomCommand(event.target.value)} placeholder="your-agent-cli" style={{ ...fieldStyle, marginTop: '5px' }} />
          </label>
        )}

        <div style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: 1.5, background: 'rgba(0,240,255,0.04)', border: '1px solid rgba(0,240,255,0.1)', borderRadius: '8px', padding: '10px' }}>
          Creates {TOPOLOGY_PRESETS[topology].roles.length} agents. Mixed mode keeps planning and testing local while using Gemini for building and review. YOLO mode stays off. Select a project root before assigning repository work.
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid var(--panel-border)', paddingTop: '12px' }}>
          <button onClick={onClose} style={{ padding: '7px 14px', border: 'none', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', color: '#fff', cursor: 'pointer' }}><X size={12} /> Cancel</button>
          <button onClick={apply} style={{ padding: '7px 14px', border: 'none', borderRadius: '6px', background: 'var(--accent-cyan)', color: '#071018', fontWeight: 700, cursor: 'pointer' }}><Check size={12} /> Apply Preset</button>
        </div>
      </div>
    </div>
  );
};
