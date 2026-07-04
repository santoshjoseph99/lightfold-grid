import React, { useEffect, useState } from 'react';
import { Terminal, Cpu, Plus, RefreshCw, X } from 'lucide-react';
import { TerminalPane } from './TerminalPane';
import { AgentConfig } from './SettingsModal';
import {
  getAgentLifecycles,
  subscribeToAgentLifecycle,
} from '../services/brokerProtocol';
import type { AgentLifecycleRecord, AgentLifecycleState } from '../services/brokerCore';

interface TerminalGridProps {
  paneIds: string[];
  activePaneId: string;
  shellPath?: string;
  cwd?: string;
  agentConfigs: Record<string, AgentConfig>;
  onSelectPane: (id: string) => void;
  onClosePane: (id: string) => void;
  onBootPane?: (id: string) => void;
  onAddPane?: () => void;
}

export const TerminalGrid: React.FC<TerminalGridProps> = ({
  paneIds,
  activePaneId,
  shellPath,
  cwd,
  agentConfigs,
  onSelectPane,
  onClosePane,
  onBootPane,
  onAddPane,
}) => {
  const [lifecycles, setLifecycles] = useState<Record<string, AgentLifecycleRecord>>(() => (
    Object.fromEntries(getAgentLifecycles().map((record) => [record.agentId, record]))
  ));

  useEffect(() => subscribeToAgentLifecycle((record) => {
    setLifecycles((current) => ({ ...current, [record.agentId]: record }));
  }), []);

  const lifecycleColor = (state: AgentLifecycleState) => {
    if (state === 'ready') return 'var(--accent-green)';
    if (state === 'busy' || state === 'starting') return 'var(--accent-orange)';
    if (state === 'failed' || state === 'unresponsive') return 'var(--accent-red)';
    return 'var(--text-muted)';
  };

  if (paneIds.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          width: '100%',
          color: 'var(--text-muted)',
          fontSize: '14px',
          background: 'rgba(255,255,255,0.01)',
          borderRadius: '12px',
          border: '1px dashed var(--glass-border)',
          gap: '12px',
          padding: '24px',
        }}
      >
        <span>No active terminal tabs. Create a tab to get started.</span>
        {onAddPane && (
          <button
            onClick={onAddPane}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              background: 'rgba(0, 240, 255, 0.1)',
              color: 'var(--accent-cyan)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0, 240, 255, 0.18)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(0, 240, 255, 0.1)')}
          >
            <Plus size={14} />
            Add Terminal Tab
          </button>
        )}
      </div>
    );
  }

  // Find the agent name for each tab
  const getTabLabel = (id: string) => {
    const config = agentConfigs[id];
    if (config && config.agentName) {
      return `${config.agentName} (${id})`;
    }
    return id;
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Dynamic Tab Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          background: 'rgba(15, 23, 42, 0.25)',
          borderBottom: '1px solid var(--panel-border)',
          padding: '4px 8px 0 8px',
          gap: '2px',
          overflowX: 'auto',
          scrollbarWidth: 'none', // Firefox
          msOverflowStyle: 'none', // IE/Edge
        }}
        className="tab-bar-container"
      >
        {paneIds.map((id) => {
          const isActive = id === activePaneId;
          const config = agentConfigs[id];
          const isAG = config?.cliCommand?.toLowerCase().includes('agy');
          const lifecycle = lifecycles[id] || { agentId: id, state: 'stopped' as const };
          const canRestart = ['failed', 'unresponsive', 'stopped'].includes(lifecycle.state);
          const heartbeat = lifecycle.lastHeartbeatAt
            ? new Date(lifecycle.lastHeartbeatAt).toLocaleTimeString()
            : 'never';
          
          return (
            <div
              key={id}
              onClick={() => onSelectPane(id)}
              title={[
                `State: ${lifecycle.state}`,
                `Current task: ${lifecycle.currentTaskId || 'none'}`,
                `Last heartbeat: ${heartbeat}`,
                lifecycle.error ? `Error: ${lifecycle.error}` : '',
              ].filter(Boolean).join('\n')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 14px',
                cursor: 'pointer',
                background: isActive ? 'rgba(10, 15, 30, 0.85)' : 'rgba(255, 255, 255, 0.01)',
                border: '1px solid var(--glass-border)',
                borderBottom: isActive ? '2px solid var(--accent-cyan)' : '1px solid transparent',
                borderRadius: '8px 8px 0 0',
                color: isActive ? '#fff' : 'var(--text-muted)',
                fontSize: '12px',
                fontWeight: 600,
                transition: 'all 0.2s',
                minWidth: '120px',
                maxWidth: '220px',
                position: 'relative',
                boxShadow: isActive ? '0 -4px 12px rgba(0, 240, 255, 0.05)' : 'none',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                  e.currentTarget.style.color = 'var(--text-main)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.01)';
                  e.currentTarget.style.color = 'var(--text-muted)';
                }
              }}
            >
              {isAG ? (
                <Cpu size={12} style={{ color: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)' }} />
              ) : (
                <Terminal size={12} style={{ color: isActive ? 'var(--accent-purple)' : 'var(--text-muted)' }} />
              )}
              
              <span
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  flex: 1,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{getTabLabel(id)}</span>
                <span
                  style={{
                    color: lifecycleColor(lifecycle.state),
                    fontSize: '8px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  {lifecycle.state}
                  {lifecycle.currentTaskId ? ` · ${lifecycle.currentTaskId.slice(0, 8)}` : ''}
                </span>
              </span>

              {canRestart && onBootPane && agentConfigs[id] && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onBootPane(id);
                  }}
                  title={`Restart ${id}`}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: lifecycleColor(lifecycle.state),
                    cursor: 'pointer',
                    padding: '2px',
                    display: 'flex',
                  }}
                >
                  <RefreshCw size={10} />
                </button>
              )}

              {/* Close Tab Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClosePane(id);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '10px',
                  padding: '2px 4px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: 0.6,
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '1';
                  e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)';
                  e.currentTarget.style.color = '#ff4a4a';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '0.6';
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-muted)';
                }}
              >
                <X size={10} />
              </button>
            </div>
          );
        })}

        {/* Add Tab Shortcut Button */}
        {onAddPane && (
          <button
            onClick={onAddPane}
            title="Add New Agent Terminal"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              border: 'none',
              background: 'transparent',
              color: 'var(--accent-cyan)',
              cursor: 'pointer',
              marginLeft: '6px',
              marginBottom: '4px',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(0, 240, 255, 0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <Plus size={16} />
          </button>
        )}
      </div>

      {/* Active Terminal Container */}
      <div
        style={{
          flex: 1,
          width: '100%',
          height: 'calc(100% - 40px)',
          position: 'relative',
        }}
      >
        <TerminalPane
          id={activePaneId}
          shellPath={shellPath}
          cwd={cwd}
          isActive={true}
          onSelect={() => {}}
          onBoot={onBootPane ? () => onBootPane(activePaneId) : undefined}
        />
      </div>
    </div>
  );
};
