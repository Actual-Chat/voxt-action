// Minimal replacement for the parts of @actions/core this action uses.
// @actions/core transitively bundles undici (~800kb) for OIDC support we
// don't need; these few functions follow the same runner protocol:
// https://docs.github.com/en/actions/reference/workflow-commands-for-github-actions

import { appendFileSync } from 'node:fs';
import { EOL } from 'node:os';
import * as crypto from 'node:crypto';

export function getInput(name: string, options?: { required?: boolean }): string {
  const value = (process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] ?? '').trim();
  if (options?.required && !value)
    throw new Error(`Input required and not supplied: ${name}`);
  return value;
}

export function getBooleanInput(name: string, options?: { required?: boolean }): boolean {
  const value = getInput(name, options);
  if (['true', 'True', 'TRUE'].includes(value))
    return true;
  if (['false', 'False', 'FALSE'].includes(value))
    return false;
  throw new TypeError(`Input is not boolean: ${name} (got: ${value})`);
}

/** Masks a value in the workflow log. */
export function setSecret(secret: string): void {
  issueCommand('add-mask', secret);
}

export function setOutput(name: string, value: string | number): void {
  const filePath = process.env['GITHUB_OUTPUT'];
  if (!filePath) {
    // Ancient runner fallback.
    issueCommand(`set-output name=${name}`, String(value));
    return;
  }
  const delimiter = `ghadelimiter_${crypto.randomUUID()}`;
  appendFileSync(filePath, `${name}<<${delimiter}${EOL}${value}${EOL}${delimiter}${EOL}`);
}

export function info(message: string): void {
  process.stdout.write(message + EOL);
}

export function error(message: string): void {
  issueCommand('error', message);
}

export function setFailed(message: string): void {
  process.exitCode = 1;
  error(message);
}

function issueCommand(command: string, value: string): void {
  const escaped = value
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
  process.stdout.write(`::${command}::${escaped}${EOL}`);
}
