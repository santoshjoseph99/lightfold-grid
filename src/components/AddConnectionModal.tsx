import React, { useState } from 'react';
import { Network, Link, Trash, X, Check } from 'lucide-react';

interface AddConnectionModalProps {
  paneIds: string[];
  connections: Record<string, string[]>;
  onSaveConnections: (connections: Record<string, string[]>) => void;
  onClose: () => void;
  agentNames?: Record<string, string>; // Optional names mapping for labels
}

export const AddConnectionModal: React.FC<AddConnectionModalProps> = ({
  paneIds,
  connections,
  onSaveConnections,
  onClose,
  agentNames = {},
}) => {
  const [source, setSource] = useState<string>(paneIds[0] || '');
  const [target, setTarget] = useState<string>(paneIds[1] || paneIds[0] || '');
  const [direction, setDirection] = useState<'bi' | 'aToB' | 'bToA'>('bi');

  // Local state for connections to guarantee immediate reactive UI updates in the modal
  const [localConns, setLocalConns] = useState<Record<string, string[]>>(() => ({ ...connections }));

  React.useEffect(() => {
    setLocalConns({ ...connections });
  }, [connections]);

  // Flatten current connections map into a list of tuples to display
  const getActiveChannels = () => {
    const list: { from: string; to: string }[] = [];
    Object.keys(localConns).forEach((src) => {
      const dests = localConns[src] || [];
      dests.forEach((dest) => {
        if (paneIds.includes(src) && paneIds.includes(dest)) {
          list.push({ from: src, to: dest });
        }
      });
    });
    return list;
  };

  const activeChannels = getActiveChannels();

  const handleAddLink = () => {
    if (source === target) {
      alert('Self-loop connections (routing back to self) are disabled.');
      return;
    }

    const updated = { ...localConns };
    let addedAny = false;

    if (direction === 'bi' || direction === 'aToB') {
      const current = updated[source] || [];
      if (!current.includes(target)) {
        updated[source] = [...current, target];
        addedAny = true;
      }
    }

    if (direction === 'bi' || direction === 'bToA') {
      const current = updated[target] || [];
      if (!current.includes(source)) {
        updated[target] = [...current, source];
        addedAny = true;
      }
    }

    if (!addedAny) {
      alert('Selected connection link(s) already exist in the active matrix graph!');
      return;
    }

    setLocalConns(updated);
    onSaveConnections(updated);
  };

  const handleRemoveLink = (from: string, to: string) => {
    const currentTargets = localConns[from] || [];
    const updated = {
      ...localConns,
      [from]: currentTargets.filter((t) => t !== to),
    };

    setLocalConns(updated);
    onSaveConnections(updated);
  };

  const getAgentLabel = (pid: string) => {
    return agentNames[pid] ? `${pid} (${agentNames[pid]})` : pid;
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
          maxWidth: '440px',
          maxHeight: '520px',
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
          <Network size={18} style={{ color: 'var(--accent-purple)' }} />
          <span style={{ fontWeight: 700, fontSize: '15px', letterSpacing: '0.05em' }}>ADD CONNECTION CHANNEL</span>
        </div>

        {/* Link creators form */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.01)',
            padding: '14px',
            borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.03)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '9px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                SENDER (FROM)
              </label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: '6px',
                  padding: '8px',
                  color: '#fff',
                  fontSize: '11px',
                  outline: 'none',
                }}
              >
                {paneIds.map((pid) => (
                  <option key={pid} value={pid} style={{ background: '#0f172a' }}>
                    {getAgentLabel(pid)}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginTop: '14px', color: 'var(--text-dark)' }}>➔</div>

            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '9px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '4px' }}>
                RECEIVER (TO)
              </label>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: '6px',
                  padding: '8px',
                  color: '#fff',
                  fontSize: '11px',
                  outline: 'none',
                }}
              >
                {paneIds.map((pid) => (
                  <option key={pid} value={pid} style={{ background: '#0f172a' }}>
                    {getAgentLabel(pid)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Direction Selector Button Group */}
          <div>
            <label style={{ display: 'block', fontSize: '9px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
              ROUTING DIRECTION
            </label>
            <div style={{ display: 'flex', gap: '6px' }}>
              {[
                { id: 'bi', label: 'Bidirectional (⇄)' },
                { id: 'aToB', label: 'Sender ➔ Recv' },
                { id: 'bToA', label: 'Recv ➔ Sender' },
              ].map((dir) => (
                <button
                  key={dir.id}
                  type="button"
                  onClick={() => setDirection(dir.id as any)}
                  style={{
                    flex: 1,
                    padding: '6px 0',
                    borderRadius: '6px',
                    border: '1px solid',
                    borderColor: direction === dir.id ? 'var(--accent-purple)' : 'var(--glass-border)',
                    background: direction === dir.id ? 'rgba(168, 85, 247, 0.08)' : 'rgba(255,255,255,0.01)',
                    color: direction === dir.id ? '#fff' : 'var(--text-muted)',
                    fontSize: '10px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {dir.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleAddLink}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              width: '100%',
              padding: '8px',
              borderRadius: '6px',
              border: 'none',
              background: 'var(--accent-purple)',
              color: '#fff',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'hsla(270, 95%, 70%, 1)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent-purple)')}
          >
            <Link size={12} />
            Establish Route Link
          </button>
        </div>

        {/* Connections List */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' }}>
          <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
            ACTIVE ROUTING PATHS ({activeChannels.length})
          </label>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {activeChannels.length === 0 ? (
              <div style={{ fontSize: '11px', color: 'var(--text-dark)', padding: '12px 0', textAlign: 'center' }}>
                All routing disabled. Blocked mesh state.
              </div>
            ) : (
              activeChannels.map((ch, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.04)',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '11px',
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
                    <span style={{ color: 'var(--accent-cyan)' }}>{ch.from}</span>
                    <span style={{ color: 'var(--text-muted)', margin: '0 8px' }}>➔</span>
                    <span style={{ color: 'var(--accent-purple)' }}>{ch.to}</span>
                  </span>
                  
                  <button
                    onClick={() => handleRemoveLink(ch.from, ch.to)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: '2px',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent-red)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
                  >
                    <Trash size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--panel-border)', paddingTop: '12px' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            Changes auto-saved to lightfold-grid-workspace.json
          </span>
          <button
            onClick={onClose}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '6px 16px',
              borderRadius: '6px',
              border: 'none',
              background: 'rgba(255,255,255,0.06)',
              color: 'var(--text-main)',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Check size={12} />
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
