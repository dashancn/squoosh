import { existsSync } from 'node:fs';

const COMMON_CHROMIUM_PATHS = [
  '/snap/bin/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

export function findChromiumExecutable(environment = process.env, exists = existsSync) {
  if (environment.CHROMIUM) return environment.CHROMIUM;
  const executable = COMMON_CHROMIUM_PATHS.find(exists);
  if (executable) return executable;
  throw new Error('Set CHROMIUM to a Chromium/Chrome executable; no common installation path was found.');
}
