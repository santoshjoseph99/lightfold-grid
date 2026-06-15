import assert from 'node:assert/strict';
import test from 'node:test';
import {
  credentialSigningReadinessPassed,
  evaluateSigningReadiness,
  formatSigningReadinessMarkdown,
  repositorySigningReadinessPassed,
} from '../src/services/releaseSigning.ts';

const readyInput = {
  packageJson: {
    build: {
      afterSign: 'scripts/notarize.mjs',
      mac: {
        icon: 'build/icon.icns',
        hardenedRuntime: true,
        entitlements: 'build/entitlements.mac.plist',
        entitlementsInherit: 'build/entitlements.mac.plist',
      },
      win: { icon: 'build/icon.png' },
      linux: { icon: 'build/icon.png' },
    },
  },
  files: {
    '.github/workflows/release.yml': 'release:signing-readiness -- --require-credentials CSC_IDENTITY_AUTO_DISCOVERY MAC_CSC_LINK WIN_CSC_LINK',
    'build/icon.icns': 'icon',
    'build/icon.png': 'icon',
    'build/entitlements.mac.plist': 'entitlements',
    'scripts/notarize.mjs': '@electron/notarize APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID',
  },
};

test('repository signing preparation passes while credentials remain external', () => {
  const checks = evaluateSigningReadiness(readyInput);
  assert.equal(repositorySigningReadinessPassed(checks), true);
  assert.equal(credentialSigningReadinessPassed(checks, 'all'), false);
  assert.match(formatSigningReadinessMarkdown(checks), /Repository readiness: PASS/);
});

test('platform credential gates require every signing secret', () => {
  const checks = evaluateSigningReadiness({
    ...readyInput,
    environment: {
      MAC_CSC_LINK: 'certificate',
      MAC_CSC_KEY_PASSWORD: 'password',
      APPLE_ID: 'maintainer@example.com',
      APPLE_APP_SPECIFIC_PASSWORD: 'password',
      APPLE_TEAM_ID: 'team',
      WIN_CSC_LINK: 'certificate',
      WIN_CSC_KEY_PASSWORD: 'password',
    },
  });
  assert.equal(credentialSigningReadinessPassed(checks, 'mac'), true);
  assert.equal(credentialSigningReadinessPassed(checks, 'win'), true);
  assert.equal(credentialSigningReadinessPassed(checks, 'all'), true);
});

test('missing release identity or tagged gate blocks repository readiness', () => {
  const checks = evaluateSigningReadiness({
    ...readyInput,
    files: { ...readyInput.files, 'build/icon.png': '' },
  });
  assert.equal(repositorySigningReadinessPassed(checks), false);
  assert.equal(checks.find((check) => check.id === 'application-icons')?.status, 'block');
});
