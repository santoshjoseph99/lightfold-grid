export type AlphaReadinessStatus = 'pass' | 'block';

export interface AlphaReadinessCheck {
  id: string;
  label: string;
  status: AlphaReadinessStatus;
  external: boolean;
  detail: string;
}

export interface AlphaReadinessInput {
  packageJson: { version?: string; license?: string };
  files: Record<string, string>;
}

const includesAll = (value: string, patterns: RegExp[]) => patterns.every((pattern) => pattern.test(value));

export const evaluateAlphaReadiness = ({ packageJson, files }: AlphaReadinessInput): AlphaReadinessCheck[] => {
  const read = (path: string) => files[path] || '';
  const ci = read('.github/workflows/ci.yml');
  const release = read('.github/workflows/release.yml');
  const readme = read('README.md');
  const security = read('SECURITY.md');
  const limitations = read('KNOWN_LIMITATIONS.md');
  const benchmarks = read('BENCHMARKS.md');
  const liveBenchmarkExample = read('benchmarks/live-example/campaign.json');
  const signing = read('RELEASE_SIGNING.md');
  const hostedValidation = read('HOSTED_VALIDATION.md');
  const hostedValidationExample = read('hosted-validation/example.json');
  const tests = Object.entries(files)
    .filter(([path]) => path.startsWith('tests/'))
    .map(([, value]) => value)
    .join('\n');
  const repositoryChecks: AlphaReadinessCheck[] = [
    {
      id: 'alpha-version-license',
      label: 'Alpha version and license',
      status: /-alpha\./.test(packageJson.version || '') && packageJson.license === 'Apache-2.0' ? 'pass' : 'block',
      external: false,
      detail: 'Package version is explicitly alpha and licensed under Apache-2.0.',
    },
    {
      id: 'public-policies',
      label: 'Public governance and security policies',
      status: ['LICENSE', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'GOVERNANCE.md', 'SECURITY.md', 'SUPPORT.md']
        .every((path) => Boolean(read(path))) ? 'pass' : 'block',
      external: false,
      detail: 'Required public contribution, governance, support, and security documents exist.',
    },
    {
      id: 'known-limitations',
      label: 'Prominent experimental status and limitations',
      status: /experimental developer alpha/i.test(readme) && /KNOWN_LIMITATIONS\.md/.test(readme) && limitations.length > 0
        ? 'pass'
        : 'block',
      external: false,
      detail: 'README warning links to a dedicated known-limitations document.',
    },
    {
      id: 'cross-platform-ci',
      label: 'Cross-platform CI',
      status: includesAll(ci, [/ubuntu-latest/, /macos-latest/, /windows-latest/, /npm test/, /test:integration/, /npm run build/])
        ? 'pass'
        : 'block',
      external: false,
      detail: 'CI covers Windows, macOS, Linux, deterministic tests, real PTYs, and production builds.',
    },
    {
      id: 'native-dependencies',
      label: 'Native dependency smoke tests',
      status: /native:smoke/.test(ci) && /native:smoke/.test(release) ? 'pass' : 'block',
      external: false,
      detail: 'CI and release jobs smoke-test node-pty and SQLite on every packaging platform.',
    },
    {
      id: 'security-controls',
      label: 'Security-sensitive approval controls',
      status: includesAll(security, [/explicit approval/i, /YOLO/i, /not a sandbox/i]) &&
        includesAll(tests, [/requiresApproval/, /approveReview/, /yoloMode/]) ? 'pass' : 'block',
      external: false,
      detail: 'Trust boundaries and approval gates are documented and covered by tests.',
    },
    {
      id: 'diagnostic-redaction',
      label: 'Diagnostic secret redaction',
      status: includesAll(tests, [/diagnostic exports recursively redact secrets/, /realistic provider and registry credentials/])
        ? 'pass'
        : 'block',
      external: false,
      detail: 'Diagnostic redaction covers nested secrets and realistic provider credentials.',
    },
    {
      id: 'source-provenance',
      label: 'Source and bundled-asset provenance',
      status: Boolean(read('SOURCE_PROVENANCE.md')) ? 'pass' : 'block',
      external: false,
      detail: 'Publishability review and contributor provenance expectations are recorded.',
    },
    {
      id: 'reproducible-proof',
      label: 'Reproducible reference benchmark',
      status: /benchmark:reference/.test(ci) && Boolean(read('benchmark-results/latest.json')) ? 'pass' : 'block',
      external: false,
      detail: 'CI verifies committed benchmark summaries against the reference suite.',
    },
    {
      id: 'live-proof-contract',
      label: 'Pinned live-model evidence contract',
      status: /benchmark:live:contract/.test(ci) &&
        /benchmark:live:validate/.test(benchmarks) &&
        Boolean(liveBenchmarkExample)
        ? 'pass'
        : 'block',
      external: false,
      detail: 'CI validates the pinned provenance, repetition, raw-evidence, and comparison contract.',
    },
    {
      id: 'credential-ready-signing',
      label: 'Credential-ready release signing',
      status: /release:signing-readiness/.test(ci) &&
        /release:signing-readiness/.test(release) &&
        /MAC_CSC_LINK/.test(signing) &&
        /WIN_CSC_LINK/.test(signing)
        ? 'pass'
        : 'block',
      external: false,
      detail: 'Repository configuration and automation are ready to require signing credentials.',
    },
    {
      id: 'hosted-validation-contract',
      label: 'Hosted validation evidence contract',
      status: /hosted:validation/.test(ci) &&
        /hosted:collect/.test(hostedValidation) &&
        Boolean(hostedValidationExample)
        ? 'pass'
        : 'block',
      external: false,
      detail: 'CI validates the hosted GitHub Actions evidence schema and collection workflow.',
    },
  ];
  const externalBlockers: AlphaReadinessCheck[] = [
    {
      id: 'hosted-ci-validation',
      label: 'Hosted cross-platform CI validation',
      status: 'block',
      external: true,
      detail: 'The configured Windows, macOS, and Linux jobs must pass on the public branch.',
    },
    {
      id: 'name-clearance',
      label: 'Legal name clearance',
      status: 'block',
      external: true,
      detail: 'Trademark, domain, app-store, and legal review require maintainer action.',
    },
    {
      id: 'release-signing',
      label: 'Release signing and notarization',
      status: 'block',
      external: true,
      detail: 'Signing identities and notarization credentials are not configured.',
    },
    {
      id: 'external-alpha',
      label: 'Independent alpha-user validation',
      status: 'block',
      external: true,
      detail: 'New-user installation and first-workflow sessions require external participants.',
    },
    {
      id: 'live-model-proof',
      label: 'Pinned live-model comparison',
      status: 'block',
      external: true,
      detail: 'Repeated pinned-model benchmark runs and published raw outcomes remain outstanding.',
    },
  ];
  return [...repositoryChecks, ...externalBlockers];
};

export const repositoryReadinessPassed = (checks: AlphaReadinessCheck[]) =>
  checks.filter((check) => !check.external).every((check) => check.status === 'pass');

export const formatAlphaReadinessMarkdown = (checks: AlphaReadinessCheck[]) => [
  '# Public Alpha Readiness',
  '',
  '| Gate | Type | Status | Detail |',
  '| --- | --- | --- | --- |',
  ...checks.map((check) =>
    `| ${check.label} | ${check.external ? 'External blocker' : 'Repository'} | ${check.status.toUpperCase()} | ${check.detail} |`,
  ),
  '',
  `Repository readiness: ${repositoryReadinessPassed(checks) ? 'PASS' : 'BLOCKED'}`,
  '',
].join('\n');
