import { existsSync } from 'fs';
import { join } from 'path';

export const PRODUCT_SLUG = 'lightfold-grid';
export const LEGACY_PRODUCT_SLUG = 'starlight';

export const preferredCompatiblePath = (
  directory: string,
  currentFilename: string,
  legacyFilename: string,
  legacyDirectory = directory,
): string => {
  const currentPath = join(directory, currentFilename);
  const legacyPath = join(legacyDirectory, legacyFilename);
  return existsSync(currentPath) || !existsSync(legacyPath) ? currentPath : legacyPath;
};

export const brokerDatabasePath = (directory: string, legacyDirectory = directory): string =>
  preferredCompatiblePath(
    directory,
    `${PRODUCT_SLUG}-broker.sqlite`,
    `${LEGACY_PRODUCT_SLUG}-broker.sqlite`,
    legacyDirectory,
  );

export const workspaceConfigPath = (directory: string, legacyDirectory = directory): string =>
  preferredCompatiblePath(
    directory,
    `${PRODUCT_SLUG}-workspace.json`,
    `${LEGACY_PRODUCT_SLUG}-workspace.json`,
    legacyDirectory,
  );
