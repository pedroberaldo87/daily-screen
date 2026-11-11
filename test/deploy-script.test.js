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

test('deploy.sh stages nothing in fixed, predictable /tmp paths (except the one-off legacy cleanup)', () => {
  const offending = deploy.split('\n')
    .filter((l) => /\/tmp\/daily-screen/.test(l))
    .filter((l) => !/^\s*rm -f\b/.test(l));
  assert.deepEqual(offending, []);
});

test('deploy.sh removes the legacy fixed-path files an older deploy left on the server', () => {
  assert.match(deploy, /^\s*rm -f \/tmp\/daily-screen-env-backup \/tmp\/daily-screen-deploy\.tar\.gz\s*$/m);
});

test('deploy.sh builds the tarball from the same git-archive context as the image', () => {
  const tarCall = deploy.match(/tar -czf[\s\S]*?\n\n/)[0];
  assert.match(tarCall, /-C "\$BUILD_CTX"/);
  assert.doesNotMatch(tarCall, /-C "\$APP_DIR"/);
});

test('README host-key snippets use mktemp, not a fixed /tmp key file', () => {
  for (const f of ['README.md', 'README.pt-BR.md']) {
    const txt = fs.readFileSync(path.join(root, f), 'utf8');
    assert.doesNotMatch(txt, /\/tmp\/[\w-]+\.key/, `${f} still writes a key to a fixed /tmp path`);
    assert.match(txt, /keyfile=\$\(mktemp\)/, `${f} should use mktemp`);
  }
});

test('deploy.sh does not apply umask 077 to the whole remote script', () => {
  assert.doesNotMatch(deploy, /^umask 077\s*$/m);
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

// ── Behavioural run against fake ssh/scp/docker binaries ─────────────────────────────────────
// No network and no real docker: PATH-injected stubs run the "remote" side locally inside a
// sandbox directory, and the sandbox stands in for the server's /tmp.
const os = require('node:os');

function runFakeDeploy({ dirty }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-test-'));
  const bin = path.join(tmp, 'bin');
  const repo = path.join(tmp, 'repo');
  const fakeTmp = path.join(tmp, 'fake-tmp');
  const deployPath = path.join(tmp, 'remote', 'opt', 'app');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(repo, 'docker'), { recursive: true });
  fs.mkdirSync(fakeTmp);
  fs.mkdirSync(path.join(deployPath, 'docker'), { recursive: true });

  const stub = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  // ssh: drop "-i X -o Y" pairs and the host, then run the command (or stdin script) locally,
  // with the server's /tmp redirected into the sandbox.
  stub('ssh', 'while [ $# -gt 0 ]; do case "$1" in -i|-o) shift 2;; *) break;; esac; done\n' +
    'shift\n' +
    'if [ "$*" = "bash -s" ]; then sed "s#/tmp/daily-screen#$FAKE_TMP/daily-screen#g" | bash -s; else exec bash -c "$*"; fi');
  stub('scp', 'while [ $# -gt 0 ]; do case "$1" in -i|-o) shift 2;; *) break;; esac; done\n' +
    'cp "$1" "${2#*:}"');
  stub('docker', 'case "$1" in save) echo fakeimage;; ps) echo abc123;; load) cat >/dev/null;; esac\nexit 0');
  stub('sleep', 'exit 0');

  fs.copyFileSync(path.join(root, 'deploy.sh'), path.join(repo, 'deploy.sh'));
  fs.writeFileSync(path.join(repo, 'docker', 'docker-compose.yml'), 'committed-compose\n');
  fs.writeFileSync(path.join(repo, 'app.txt'), 'committed-app\n');
  const git = (...args) => spawnSync('git', ['-C', repo, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('add', '.');
  assert.equal(git('commit', '-q', '-m', 'init').status, 0);
  if (dirty) {
    fs.writeFileSync(path.join(repo, 'docker', 'docker-compose.yml'), 'UNCOMMITTED-compose\n');
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'untracked\n');
  }

  fs.writeFileSync(path.join(deployPath, 'docker', '.env'), 'SECRET=example\n', { mode: 0o600 });
  fs.writeFileSync(path.join(fakeTmp, 'daily-screen-env-backup'), 'SECRET=old\n');
  fs.writeFileSync(path.join(fakeTmp, 'daily-screen-deploy.tar.gz'), 'old');
  const knownHosts = path.join(tmp, 'known_hosts');
  fs.writeFileSync(knownHosts, 'example.com ssh-ed25519 AAAAexample\n');

  const r = spawnSync('bash', [path.join(repo, 'deploy.sh')], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: tmp,
      TMPDIR: tmp,
      FAKE_TMP: fakeTmp,
      DEPLOY_HOST: 'example.com',
      DEPLOY_KEY: path.join(tmp, 'key'),
      DEPLOY_PATH: deployPath,
      DEPLOY_KNOWN_HOSTS: knownHosts,
    },
  });
  return { tmp, r, deployPath, fakeTmp };
}

test('fake deploy: the shipped tree is the committed tree, not the working tree', (t) => {
  const { tmp, r, deployPath } = runFakeDeploy({ dirty: true });
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(path.join(deployPath, 'docker', 'docker-compose.yml'), 'utf8'), 'committed-compose\n');
  assert.equal(fs.existsSync(path.join(deployPath, 'untracked.txt')), false);
  assert.match(r.stderr, /uncommitted changes/i);
});

test('fake deploy: a clean tree deploys without the dirty-tree warning', (t) => {
  const { tmp, r, deployPath } = runFakeDeploy({ dirty: false });
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(path.join(deployPath, 'app.txt'), 'utf8'), 'committed-app\n');
  assert.doesNotMatch(r.stderr, /uncommitted changes/i);
});

test('fake deploy: legacy fixed-path secrets are removed and the extracted tree stays readable', (t) => {
  const { tmp, r, deployPath, fakeTmp } = runFakeDeploy({ dirty: false });
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.existsSync(path.join(fakeTmp, 'daily-screen-env-backup')), false);
  assert.equal(fs.existsSync(path.join(fakeTmp, 'daily-screen-deploy.tar.gz')), false);
  // umask 077 must not leak into tar -x: files keep their archive modes (0644 from the archive).
  const mode = fs.statSync(path.join(deployPath, 'docker', 'docker-compose.yml')).mode & 0o777;
  assert.notEqual(mode, 0o600, 'extracted app tree must not be forced to 0600');
  // docker/.env keeps its restrictive mode.
  assert.equal(fs.statSync(path.join(deployPath, 'docker', '.env')).mode & 0o777, 0o600);
});
