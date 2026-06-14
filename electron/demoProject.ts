import { cpSync, existsSync, mkdirSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import * as path from 'path';

export const createDemoProject = (templateDirectory: string, parentDirectory: string): string => {
  const target = path.join(parentDirectory, 'lightfold-grid-demo');
  if (existsSync(target)) throw new Error(`Demo target already exists: ${target}`);
  mkdirSync(target, { recursive: true });
  try {
    cpSync(templateDirectory, target, { recursive: true });
    const git = (args: string[]) => execFileSync('git', args, { cwd: target, stdio: 'ignore' });
    git(['init', '-b', 'main']);
    git(['config', 'user.email', 'lightfold-grid-demo@example.test']);
    git(['config', 'user.name', 'Lightfold Grid Demo']);
    git(['config', 'core.autocrlf', 'false']);
    git(['add', '.']);
    git(['commit', '-m', 'Create Lightfold Grid demo repository']);
    return target;
  } catch (error) {
    rmSync(target, { recursive: true, force: true });
    throw error;
  }
};
