import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readRuntimeConfig } from './runtime-config.js';

export function readConfig(env = process.env) {
  return {...readRuntimeConfig(env), clientDirectory:fileURLToPath(new URL('../../client/dist/', import.meta.url))};
}

export function checkBuild(config) {
  if (config.production && !existsSync(config.clientDirectory + '/index.html')) throw new Error('Build the client before starting production.');
}
