export const disablePersistedYoloModes = <Config extends { yoloMode?: boolean }>(
  configs: Record<string, Config> | undefined,
): Record<string, Config> => Object.fromEntries(
  Object.entries(configs || {}).map(([paneId, config]) => [
    paneId,
    { ...config, yoloMode: false },
  ]),
);
