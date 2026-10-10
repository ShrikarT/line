#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const defaultArgs = ['contracts/line.compact', 'contracts/managed/line'];
const compileArgs = args.length > 0 ? args : ['--skip-zk', ...defaultArgs];

const compactBin = process.env.COMPACT_BIN;
const wslDistro = process.env.WSL_DISTRO || 'Ubuntu';
const { compact } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(compact?.compiler ?? '')) throw new Error('Missing pinned Compact compiler version in package.json');
const managerArgs = ['compile', `+${compact.compiler}`, ...compileArgs];
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

function finish(result) {
  if (result.error) console.error(`Compact could not start: ${result.error.message}`);
  process.exit(result.status ?? 1);
}

if (os.platform() === 'win32') {
  const cwd = process.cwd().replace(/\\/g, '/');
  const binSelection = compactBin
    ? `line_compact_bin=${quote(compactBin)}`
    : 'line_compact_bin=$(command -v compact || true); if [ -z "$line_compact_bin" ]; then line_compact_bin=/home/shrikar/.local/bin/compact; fi';
  // Resolve once: a compiler failure must not retry a different default compiler.
  const portableArgument = value => /^[a-zA-Z]:[\\/]/.test(value)
    ? `"$(wslpath -u ${quote(value.replace(/\\/g, '/'))})"` : quote(value);
  const wslCmd = `set -e -o pipefail\ncd "$(wslpath -u ${quote(cwd)})"\n${binSelection}\nexec "$line_compact_bin" ${managerArgs.map(portableArgument).join(' ')}`;
  // Feed code on stdin: WSL's Windows command-line quoting must not expand
  // shell variables before Bash assigns them.
  const res = spawnSync('wsl', ['-d', wslDistro, '--exec', 'bash', '-s'], {
    input: `${wslCmd}\n`,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  finish(res);
} else {
  const bin = compactBin || 'compact';
  const res = spawnSync(bin, managerArgs, { stdio: 'inherit' });
  finish(res);
}

