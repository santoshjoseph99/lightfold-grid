import React, { useRef, useLayoutEffect, useState } from 'react';
import { Terminal, Cpu } from 'lucide-react';
import { createTerminalInstance, getTerminalInstance, removeTerminalInstance } from '../services/terminalRegistry';

interface TerminalPaneProps {
  id: string;
  shellPath?: string;
  cwd?: string;
  isActive: boolean;
  onSelect: () => void;
  onClose?: () => void;
  onBoot?: () => void;
}

export const TerminalPane: React.FC<TerminalPaneProps> = ({
  id,
  shellPath,
  cwd,
  isActive,
  onSelect,
  onClose,
  onBoot,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [pid, setPid] = useState<number | null>(null);

  useLayoutEffect(() => {
    let active = true;
    let observer: ResizeObserver | null = null;
    let termInstance: any = null;

    createTerminalInstance(id, shellPath, cwd)
      .then((instance) => {
        if (!active) return;
        termInstance = instance;
        setPid((instance.terminal as any)._core?.pty?.pid || null);
        setLoading(false);

        // Mount cached DOM node
        if (mountRef.current) {
          mountRef.current.appendChild(instance.container);
          // Trigger immediate fit
          setTimeout(() => {
            try {
              instance.fitAddon.fit();
              instance.terminal.focus();
            } catch (e) {
              console.error('Initial terminal fit failed:', e);
            }
          }, 50);
        }

        // Auto-boot agent if it hasn't been booted yet for this terminal session
        if (!instance.isBooted && onBoot) {
          instance.isBooted = true;
          setTimeout(() => {
            if (active) {
              onBoot();
            }
          }, 400); // small delay to ensure terminal is active and focused
        }

        // Setup ResizeObserver to automatically resize terminal cells on panels grid adjustment
        observer = new ResizeObserver((entries) => {
          if (!active) return;
          // Throttle resize triggers to avoid layout stutter
          requestAnimationFrame(() => {
            try {
              instance.fitAddon.fit();
            } catch (err) {
              // Ignore fit errors if element is detached
            }
          });
        });

        if (mountRef.current) {
          observer.observe(mountRef.current);
        }
      })
      .catch((err) => {
        console.error('Failed to initialize terminal:', err);
      });

    return () => {
      active = false;
      if (observer) {
        observer.disconnect();
      }
      
      // Move raw node back to offscreen cache so it isn't destroyed
      if (termInstance && termInstance.container) {
        const cache = document.getElementById('offscreen-terminal-cache');
        if (cache) {
          try {
            cache.appendChild(termInstance.container);
          } catch (e) {
            // Ignore if parent already detached
          }
        }
      }
    };
  }, [id, shellPath, cwd]);

  const handleWrapperClick = () => {
    onSelect();
    const instance = getTerminalInstance(id);
    if (instance) {
      instance.terminal.focus();
    }
  };

  return (
    <div
      onClick={handleWrapperClick}
      className={`terminal-wrapper glass-panel ${isActive ? 'active' : ''}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
      }}
    >
      <div className="terminal-header" style={{ pointerEvents: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Terminal size={14} className={isActive ? 'text-cyan' : ''} style={{ color: isActive ? 'var(--accent-cyan)' : 'inherit' }} />
          <span style={{ fontWeight: 600, color: isActive ? 'var(--text-main)' : 'var(--text-muted)' }}>
            {id} {pid ? `(PID: ${pid})` : ''}
          </span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {onBoot && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onBoot();
              }}
              title="Boot Agent with custom CLI command & system prompt instructions"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                background: 'rgba(0, 240, 255, 0.08)',
                border: 'none',
                color: 'var(--accent-cyan)',
                cursor: 'pointer',
                fontSize: '10px',
                padding: '3px 8px',
                borderRadius: '4px',
                fontWeight: 600,
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0, 240, 255, 0.15)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(0, 240, 255, 0.08)')}
            >
              <Cpu size={10} />
              Boot Agent
            </button>
          )}

          {onClose && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '14px',
              padding: '2px 6px',
              borderRadius: '4px',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            ✕
          </button>
        )}
        </div>
      </div>

      <div
        ref={mountRef}
        className="terminal-container"
        style={{
          flex: 1,
          width: '100%',
          position: 'relative',
          background: '#0a0c12',
          opacity: loading ? 0.3 : 1,
          transition: 'opacity 0.2s',
        }}
      />
    </div>
  );
};
