/* eslint import/no-dynamic-require:0 */
/**
 * Code signing is handled separately by the Azure Trusted Signing action in
 * the GitHub workflow. This script creates an unsigned installer which is
 * then signed by the workflow after creation.
 */
const path = require('path');
const { createWindowsInstaller } = require('electron-winstaller');

const appDir = path.join(__dirname, '..');
const { version } = require(path.join(appDir, 'package.json'));

const config = {
  usePackageJson: false,
  outputDirectory: path.join(appDir, 'dist'),
  appDirectory: path.join(appDir, 'dist', 'mailspring-win32-x64'),
  loadingGif: path.join(appDir, 'build', 'resources', 'win', 'loading.gif'),
  iconUrl: 'http://mailspring-builds.s3.amazonaws.com/assets/mailspring-square.ico',
  description: "Stepan's own email client, forked from Mailspring",
  version: version,
  title: 'DemonMail',
  authors: 'Stepan Pejchar',
  setupIcon: path.join(appDir, 'build', 'resources', 'win', 'mailspring-square.ico'),
  setupExe: 'DemonMailSetup.exe',
  // exe / name must keep "mailspring" — see the note in build.js: the prebuilt
  // mailsync.exe won't start unless its path contains that substring, and `name`
  // decides the install dir (%LOCALAPPDATA%\<name>\app-x.x.x).
  exe: 'mailspring.exe',
  name: 'Mailspring',
};

console.log(config);
console.log('---> Starting');

createWindowsInstaller(config)
  .then(() => {
    console.log('createWindowsInstaller succeeded.');
    process.exit(0);
  })
  .catch(e => {
    console.error(`createWindowsInstaller failed: ${e.message}`);
    process.exit(1);
  });
