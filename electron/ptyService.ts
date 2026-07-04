import * as fs from 'fs';
import * as path from 'path';
import * as pty from 'node-pty';

const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
);

export interface PtySpawnOptions {
  id: string;
  executable: string;
  args?: string[];
  cwd: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  logFilePath?: string;
}

export interface PtyExit {
  exitCode: number;
  signal?: number;
}

export interface PtyServiceOptions {
  onData?: (id: string, data: string) => void;
  onExit?: (id: string, exit: PtyExit) => void;
}

export const stripTerminalAnsi = (text: string): string =>
  text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

export class PtyService {
  private readonly processes = new Map<string, pty.IPty>();
  private readonly options: PtyServiceOptions;

  constructor(options: PtyServiceOptions = {}) {
    this.options = options;
  }

  spawn(options: PtySpawnOptions): { success: true; pid: number } {
    if (this.processes.has(options.id)) {
      throw new Error(`PTY ${options.id} is already running.`);
    }
    if (options.logFilePath) {
      fs.mkdirSync(path.dirname(options.logFilePath), { recursive: true });
      fs.writeFileSync(options.logFilePath, `--- Terminal Log Started for ${options.id} ---\n`, 'utf8');
    }
    const process = pty.spawn(options.executable, options.args || [], {
      name: 'xterm-256color',
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: options.cwd,
      env: {
        ...inheritedEnv,
        ...options.env,
        TERM: options.env?.TERM || 'xterm-256color',
      },
    });
    this.processes.set(options.id, process);
    process.onData((data) => {
      this.options.onData?.(options.id, data);
      if (options.logFilePath) {
        fs.appendFile(options.logFilePath, stripTerminalAnsi(data), 'utf8', () => {});
      }
    });
    process.onExit((exit) => {
      // Only delete if this is still the active process for this ID.
      // A killed PTY's onExit can fire after a new PTY with the same ID
      // has already been spawned, which would wrongly evict the new one.
      if (this.processes.get(options.id) === process) {
        this.processes.delete(options.id);
      }
      this.options.onExit?.(options.id, exit);
      if (options.logFilePath) {
        fs.appendFile(
          options.logFilePath,
          `\n--- Terminal Process Exited (Code: ${exit.exitCode}) ---\n`,
          'utf8',
          () => {}
        );
      }
    });
    return { success: true, pid: process.pid };
  }

  write(id: string, data: string): boolean {
    const process = this.processes.get(id);
    if (!process) return false;
    process.write(data);
    return true;
  }

  resize(id: string, cols: number, rows: number): boolean {
    const process = this.processes.get(id);
    if (!process) return false;
    process.resize(cols, rows);
    return true;
  }

  kill(id: string): boolean {
    const process = this.processes.get(id);
    if (!process) return false;
    process.kill();
    this.processes.delete(id);
    return true;
  }

  has(id: string): boolean {
    return this.processes.has(id);
  }

  pid(id: string): number | undefined {
    return this.processes.get(id)?.pid;
  }

  close() {
    for (const process of this.processes.values()) process.kill();
    this.processes.clear();
  }
}
