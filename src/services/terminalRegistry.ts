import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

// Add CSS stylesheet programmatically to the renderer to render xterm.js correctly
if (typeof document !== 'undefined') {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'node_modules/xterm/css/xterm.css';
  document.head.appendChild(link);
}

export interface TerminalInstance {
  id: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  container: HTMLDivElement;
  onDataUnsubscribe: () => void;
  onExitUnsubscribe: () => void;
  isBooted?: boolean;
  cwd?: string;
  shellPath?: string;
}

const registry = new Map<string, TerminalInstance>();
type StreamListener = (id: string, chunk: string) => void;
const streamListeners = new Set<StreamListener>();

export const getTerminalInstance = (id: string): TerminalInstance | undefined => {
  return registry.get(id);
};

export const createTerminalInstance = (
  id: string,
  shellPath?: string,
  cwd?: string
): Promise<TerminalInstance> => {
  const existing = registry.get(id);
  if (existing) {
    if (existing.cwd === cwd && existing.shellPath === shellPath) {
      return Promise.resolve(existing);
    }
    // Configuration has changed (e.g. CWD updated): destroy stale process
    removeTerminalInstance(id);
  }

  const container = document.createElement('div');
  container.className = 'terminal-wrapper-inner';
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.overflow = 'hidden';

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
    lineHeight: 1.2,
    theme: {
      background: '#0a0c12',
      foreground: '#e5e7eb',
      cursor: '#00f0ff',
      black: '#1f2937',
      red: '#ef4444',
      green: '#10b981',
      yellow: '#f59e0b',
      blue: '#3b82f6',
      magenta: '#8b5cf6',
      cyan: '#06b6d4',
      white: '#f3f4f6',
    },
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  const electronAPI = (window as any).electronAPI;

  return electronAPI.spawnPty({ id, cols: 80, rows: 24, shellPath, cwd }).then((res: any) => {
    if (!res.success) {
      throw new Error(res.error || 'Failed to spawn PTY');
    }

    term.open(container);

    const onDataUnsubscribe = electronAPI.onPtyData(id, (data: string) => {
      term.write(data);
      // Notify broker listeners
      notifyListeners(id, data);
    });

    const onExitUnsubscribe = electronAPI.onPtyExit(id, () => {
      term.write('\r\n\x1b[1;31m[Process terminated]\x1b[0m\r\n');
    });

    term.onData((data) => {
      electronAPI.writePty(id, data);
    });

    // Cache off-screen initially
    const cache = document.getElementById('offscreen-terminal-cache');
    if (cache) {
      cache.appendChild(container);
    }

    const instance: TerminalInstance = {
      id,
      terminal: term,
      fitAddon,
      container,
      onDataUnsubscribe,
      onExitUnsubscribe,
      cwd,
      shellPath,
    };

    registry.set(id, instance);
    return instance;
  });
};

export const removeTerminalInstance = (id: string) => {
  const instance = registry.get(id);
  if (instance) {
    instance.onDataUnsubscribe();
    instance.onExitUnsubscribe();
    instance.terminal.dispose();
    instance.container.remove();
    (window as any).electronAPI.killPty(id);
    registry.delete(id);
  }
};

export const subscribeToStream = (listener: StreamListener) => {
  streamListeners.add(listener);
  return () => {
    streamListeners.delete(listener);
  };
};

const notifyListeners = (id: string, chunk: string) => {
  streamListeners.forEach((l) => l(id, chunk));
};
