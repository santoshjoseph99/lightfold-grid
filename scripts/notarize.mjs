import { notarize } from '@electron/notarize';

export default async function notarizeApplication(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  if (!appleId || !appleIdPassword || !teamId) {
    console.log('Skipping notarization because Apple credentials are not configured.');
    return;
  }

  await notarize({
    appBundleId: context.packager.appInfo.id,
    appPath: `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`,
    appleId,
    appleIdPassword,
    teamId,
  });
}
