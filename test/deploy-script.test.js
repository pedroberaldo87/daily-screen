// Static checks for deploy.sh and .dockerignore. deploy.sh is never executed here:
// it talks to a real server. These tests only read the files and run `bash -n` / shellcheck.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const deploy = fs.readFileSync(path.join(root, 'deploy.sh'), 'utf8');
const dockerignore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

test('deploy.sh has valid bash syntax', () => {
  const r = spawnSync('bash', ['-n', path.join(root, 'deploy.sh')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('deploy.sh passes shellcheck when shellcheck is installed', (t) => {
  const probe = spawnSync('shellcheck', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) return t.skip('shellcheck not installed');
  const r = spawnSync('shellcheck', [path.join(root, 'deploy.sh')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('.dockerignore excludes .env files in any directory, including docker/.env', () => {
  assert.ok(dockerignore.includes('**/.env'), 'expected **/.env in .dockerignore');
});

test('deploy.sh never disables SSH host key verification', () => {
  assert.doesNotMatch(deploy, /StrictHostKeyChecking[= ]+(no|off|accept-new)/i);
  assert.match(deploy, /StrictHostKeyChecking=yes/);
});

test('deploy.sh pins host keys in a configurable known_hosts file for ssh and scp', () => {
  assert.match(deploy, /DEPLOY_KNOWN_HOSTS="\$\{DEPLOY_KNOWN_HOSTS:-\$HOME\/\.ssh\/known_hosts\}"/);
  assert.match(deploy, /UserKnownHostsFile=\$DEPLOY_KNOWN_HOSTS/);
  // every ssh/scp invocation must go through the shared option array
  const invocations = deploy.split('\n').filter((l) => /^\s*(ssh|scp)\s/.test(l) || /\|\s*(ssh|scp)\s/.test(l));
  for (const line of invocations) {
    assert.match(line, /"\$\{SSH_OPTS\[@\]\}"/, `ssh/scp call without SSH_OPTS: ${line}`);
  }
});

test('deploy.sh stages nothing in fixed, predictable /tmp paths', () => {
  assert.doesNotMatch(deploy, /\/tmp\/daily-screen/);
});

test('deploy.sh stages files in a private mktemp directory on the VPS', () => {
  assert.match(deploy, /umask 077/);
  assert.match(deploy, /mktemp -d/);
  assert.match(deploy, /REMOTE_STAGE=/);
});

test('deploy.sh backs up docker/.env with cp -p, never swallows the error, and cleans up with a trap', () => {
  assert.match(deploy, /cp -p "\$DEPLOY_PATH\/docker\/\.env"/);
  assert.doesNotMatch(deploy, /cp [^\n]*2>\/dev\/null \|\| true/);
  assert.match(deploy, /trap '[^']*rm -rf[^']*' EXIT/);
});
