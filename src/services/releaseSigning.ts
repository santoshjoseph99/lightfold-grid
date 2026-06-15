export type SigningPlatform = 'mac' | 'win';
export type SigningReadinessStatus = 'pass' | 'block';

export interface SigningReadinessCheck {
  id: string;
  label: string;
  status: SigningReadinessStatus;
  external: boolean;
  platform?: SigningPlatform;
  detail: string;
}

export interface SigningReadinessInput {
  packageJson: {
    build?: {
      icon?: string;
      afterSign?: string;
      mac?: Record<string, unknown>;
      win?: Record<string, unknown>;
      linux?: Record<string, unknown>;
    };
  };
  files: Record<string, string>;
  environment?: Record<string, string | undefined>;
}

const hasAll = (environment: Record<string, string | undefined>, names: string[]) =>
  names.every((name) => Boolean(environment[name]?.trim()));

export const evaluateSigningReadiness = ({
  packageJson,
  files,
  environment = {},
}: SigningReadinessInput): SigningReadinessCheck[] => {
  const build = packageJson.build || {};
  const mac = build.mac || {};
  const win = build.win || {};
  const linux = build.linux || {};
  const icon = build.icon;
  const macIcon = typeof mac.icon === 'string' ? mac.icon : icon;
  const winIcon = typeof win.icon === 'string' ? win.icon : icon;
  const linuxIcon = typeof linux.icon === 'string' ? linux.icon : icon;
  const read = (path: string | undefined) => path ? files[path] || '' : '';
  const workflow = read('.github/workflows/release.yml');
  const notarizeScript = read('scripts/notarize.mjs');

  return [
    {
      id: 'application-icons',
      label: 'Owned cross-platform application icons',
      status: [macIcon, winIcon, linuxIcon].every((path) => Boolean(path && read(path))) ? 'pass' : 'block',
      external: false,
      detail: 'macOS, Windows, and Linux packages use project-authored Lightfold Grid assets.',
    },
    {
      id: 'mac-hardened-runtime',
      label: 'macOS hardened-runtime configuration',
      status: mac.hardenedRuntime === true &&
        typeof mac.entitlements === 'string' &&
        typeof mac.entitlementsInherit === 'string' &&
        Boolean(read(mac.entitlements) && read(mac.entitlementsInherit))
        ? 'pass'
        : 'block',
      external: false,
      platform: 'mac',
      detail: 'Signed macOS builds use hardened runtime and committed entitlements.',
    },
    {
      id: 'notarization-hook',
      label: 'Credential-aware macOS notarization hook',
      status: build.afterSign === 'scripts/notarize.mjs' &&
        /@electron\/notarize/.test(notarizeScript) &&
        /APPLE_ID/.test(notarizeScript) &&
        /APPLE_APP_SPECIFIC_PASSWORD/.test(notarizeScript) &&
        /APPLE_TEAM_ID/.test(notarizeScript)
        ? 'pass'
        : 'block',
      external: false,
      platform: 'mac',
      detail: 'Packaging notarizes signed macOS apps when Apple credentials are available.',
    },
    {
      id: 'tagged-signing-gate',
      label: 'Tagged release signing gate',
      status: /release:signing-readiness -- --require-credentials/.test(workflow) &&
        /CSC_IDENTITY_AUTO_DISCOVERY/.test(workflow) &&
        /MAC_CSC_LINK/.test(workflow) &&
        /WIN_CSC_LINK/.test(workflow)
        ? 'pass'
        : 'block',
      external: false,
      detail: 'Tagged releases require signing credentials while manual builds may remain unsigned.',
    },
    {
      id: 'mac-signing-credentials',
      label: 'macOS signing and notarization credentials',
      status: hasAll(environment, [
        'MAC_CSC_LINK',
        'MAC_CSC_KEY_PASSWORD',
        'APPLE_ID',
        'APPLE_APP_SPECIFIC_PASSWORD',
        'APPLE_TEAM_ID',
      ]) ? 'pass' : 'block',
      external: true,
      platform: 'mac',
      detail: 'A Developer ID certificate and Apple notarization credentials must be configured.',
    },
    {
      id: 'windows-signing-credentials',
      label: 'Windows publisher signing credentials',
      status: hasAll(environment, ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD']) ? 'pass' : 'block',
      external: true,
      platform: 'win',
      detail: 'A trusted Windows code-signing certificate must be configured.',
    },
  ];
};

export const repositorySigningReadinessPassed = (checks: SigningReadinessCheck[]) =>
  checks.filter((check) => !check.external).every((check) => check.status === 'pass');

export const credentialSigningReadinessPassed = (
  checks: SigningReadinessCheck[],
  platform: SigningPlatform | 'all',
) => checks
  .filter((check) => check.external && (platform === 'all' || check.platform === platform))
  .every((check) => check.status === 'pass');

export const formatSigningReadinessMarkdown = (checks: SigningReadinessCheck[]) => [
  '# Release Signing Readiness',
  '',
  '| Gate | Type | Status | Detail |',
  '| --- | --- | --- | --- |',
  ...checks.map((check) =>
    `| ${check.label} | ${check.external ? 'External credential' : 'Repository'} | ${check.status.toUpperCase()} | ${check.detail} |`,
  ),
  '',
  `Repository readiness: ${repositorySigningReadinessPassed(checks) ? 'PASS' : 'BLOCKED'}`,
  '',
].join('\n');
