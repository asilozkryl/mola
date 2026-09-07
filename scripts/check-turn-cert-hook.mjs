// Focused host-hook regression checks. OpenSSL and filesystem operations are
// real; privileged ownership, flock and Docker lifecycle are explicit fakes.
// Linux exercises real symlink/pointer operations with fake Docker responses.
// On Windows without native symlink support, those lifecycle cases are skipped
// explicitly. Real ownership, container health and TURN TLS need live acceptance.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const bash = process.env.BASH_PATH || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash')
assert.ok(existsSync(bash), 'Bash required; set BASH_PATH if it is not in the default location')
mkdirSync(join(root, 'artifacts'), { recursive: true })
const fixture = mkdtempSync(join(root, 'artifacts', 'turn-cert-hook-'))
const posix = value => value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`
const path = name => posix(join(fixture, name))
const write = (name, value) => writeFileSync(join(fixture, name), value, { mode: 0o755 })
const run = (command, environment = {}) => execFileSync(bash, ['--noprofile', '--norc', '-c', command], {
  cwd: fixture, env: { ...process.env, MSYS: 'winsymlinks:lnk', ...environment }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000,
})
const checks = []
const skipped = []
try {
  for (const directory of ['mock', 'lineage', 'data', 'config']) mkdirSync(join(fixture, directory))
  write('config/cert-deploy.conf', 'TURN_COMPOSE_PROJECT=mola-turn-hook-test\n')
  // Only fixed host paths are relocated. Real host permissions and Docker are
  // intentionally outside these cross-platform behavioral tests.
  const source = readFileSync(join(root, 'ops/turn-cert-deploy.sh'), 'utf8')
    .replaceAll('/etc/letsencrypt/live/turn.psychodry.cloud', path('lineage'))
    .replaceAll('/data/mola-turn', path('data/mola-turn'))
    .replaceAll('/etc/mola-turn/cert-deploy.conf', path('config/cert-deploy.conf'))
    .replaceAll('/etc/ssl/certs/ca-certificates.crt', path('ca.pem'))
  // Production constants are unquoted fixed paths; fixture names can have spaces.
  write('hook.sh', source.replace(/^readonly (lineage|target|config)=(.*)$/gm, (_, name, value) => `readonly ${name}=${quote(value)}`)
    .replace(`for directory in ${path('data/mola-turn')} `, `for directory in ${quote(path('data/mola-turn'))} `))
  write('mock/id', '#!/bin/bash\nprintf "0\\n"\n')
  write('mock/stat', '#!/bin/bash\nif [[ $2 == %u ]]; then printf "0\\n"; elif [[ ${FAKE_WRITABLE_CONFIG:-} == yes && $3 == */cert-deploy.conf ]]; then printf "666\\n"; elif [[ -n ${FAKE_WRITABLE_PATH:-} && $3 == "$FAKE_WRITABLE_PATH" ]]; then printf "777\\n"; else printf "750\\n"; fi\n')
  write('mock/flock', '#!/bin/bash\nexit 0\n')
  write('mock/chown', '#!/bin/bash\nexit 0\n')
  write('mock/chmod', '#!/bin/bash\nexit 0\n')
  write('mock/install', '#!/bin/bash\nargs=(); directory=no; while (($#)); do case "$1" in -o|-g|-m) shift 2;; -d) directory=yes; shift;; *) args+=("$1"); shift;; esac; done\nif [[ $directory == yes ]]; then mkdir -p "${args[@]}"; else cp "${args[@]}"; fi\n')
  write('mock/docker', `#!/bin/bash
case "$1" in
 ps) case "\${FAKE_DOCKER_MODE:-none}" in none) ;; multiple) printf '${'a'.repeat(64)}\\n${'b'.repeat(64)}\\n';; *) printf '%s\\n' "\${FAKE_CONTAINER_ID:-${'a'.repeat(64)}}";; esac;;
 inspect) if [[ $3 == *Config.Labels* ]]; then
   if [[ \${FAKE_DOCKER_MODE:-} == identitychanged ]]; then printf 'unrelated-project/turn\\n'; else printf 'mola-turn-hook-test/turn\\n'; fi
   elif [[ \${FAKE_DOCKER_MODE:-} == unhealthy ]]; then printf 'false/unhealthy\\n'; else printf 'true/healthy\\n'; fi;;
 restart) printf '%s\\n' "\${@: -1}" >> ${quote(path('restarts'))}; [[ \${FAKE_DOCKER_MODE:-} != restartfail ]] || exit 1;;
 *) exit 2;;
esac
`)
  run(`chmod +x ${quote(path('mock'))}/*; bash -n ${quote(path('hook.sh'))}`)
  const openssl = command => run(`MSYS_NO_PATHCONV=1 openssl ${command} 2>/dev/null`)
  openssl(`req -x509 -newkey rsa:2048 -nodes -days 7 -subj /CN=MolaHookTestCA -keyout ca.key -out ca.pem`)
  write('extensions', 'subjectAltName=DNS:turn.psychodry.cloud\nextendedKeyUsage=serverAuth\n')
  for (const version of ['one', 'two']) {
    openssl(`req -new -newkey rsa:2048 -nodes -subj /CN=turn.psychodry.cloud -keyout ${version}.key -out ${version}.csr`)
    openssl(`x509 -req -in ${version}.csr -CA ca.pem -CAkey ca.key -set_serial ${version === 'one' ? 1 : 2} -days 5 -extfile extensions -out ${version}.pem`)
  }
  const setCertificate = version => {
    write('lineage/fullchain.pem', readFileSync(join(fixture, `${version}.pem`), 'utf8') + readFileSync(join(fixture, 'ca.pem'), 'utf8'))
    write('lineage/privkey.pem', readFileSync(join(fixture, `${version}.key`), 'utf8'))
  }
  const invoke = (mode, overrides = {}) => {
    try {
      const output = run(`export PATH=${quote(path('mock'))}:"$PATH"; bash ${quote(path('hook.sh'))}`, {
        RENEWED_LINEAGE: path('lineage'), FAKE_DOCKER_MODE: mode, ...overrides,
      })
      assert.ok(!output.includes('PRIVATE KEY'))
      return { status: 0, output }
    } catch (error) {
      return { status: error.status, output: `${error.stdout || ''}${error.stderr || ''}` }
    }
  }
  setCertificate('one')
  assert.equal(invoke('none', { RENEWED_LINEAGE: '/etc/letsencrypt/live/unrelated.example' }).status, 0)
  assert.equal(existsSync(join(fixture, 'data/mola-turn/certs')), false)
  checks.push('unrelated lineage leaves filesystem untouched')
  assert.notEqual(invoke('none', { FAKE_WRITABLE_CONFIG: 'yes' }).status, 0)
  checks.push('writable configuration rejected')
  write('lineage/privkey.pem', readFileSync(join(fixture, 'two.key'), 'utf8'))
  const mismatch = invoke('none')
  assert.notEqual(mismatch.status, 0)
  assert.match(mismatch.output, /do not match/)
  assert.equal(existsSync(join(fixture, 'data/mola-turn/certs/current')), false)
  checks.push('mismatched key rejected before publication')
  write('extensions', 'subjectAltName=DNS:unrelated.example\nextendedKeyUsage=serverAuth\n')
  openssl('x509 -req -in two.csr -CA ca.pem -CAkey ca.key -set_serial 3 -days 5 -extfile extensions -out two.pem')
  setCertificate('two')
  const hostname = invoke('none')
  assert.notEqual(hostname.status, 0)
  assert.match(hostname.output, /hostname/)
  checks.push('wrong certificate hostname rejected before publication')
  write('extensions', 'subjectAltName=DNS:turn.psychodry.cloud\nextendedKeyUsage=serverAuth\n')
  openssl('x509 -req -in two.csr -CA ca.pem -CAkey ca.key -set_serial 4 -days 0 -extfile extensions -out two.pem')
  setCertificate('two')
  const expiry = invoke('none')
  assert.notEqual(expiry.status, 0)
  assert.match(expiry.output, /expires within/)
  checks.push('expired or imminent-expiry certificate rejected before publication')
  setCertificate('one')
  const staged = invoke('none')
  assert.equal(staged.status, 0, staged.output)
  assert.match(staged.output, /certificate staged/)
  checks.push('matching trusted certificate passes staging validation')
  const current = () => run(`readlink ${quote(path('data/mola-turn/certs/current'))}`).trim()
  const restarts = () => existsSync(join(fixture, 'restarts')) ? readFileSync(join(fixture, 'restarts'), 'utf8').trim().split('\n') : []
  const supportsSymlinks = run(`if [[ -L ${quote(path('data/mola-turn/certs/current'))} ]]; then printf yes; fi`) === 'yes'
  if (!supportsSymlinks) {
    assert.equal(process.platform, 'win32', 'Linux hook must create a genuine current symlink')
    skipped.push('Lifecycle and symlink rejection cases require Linux; this Windows host materializes directory symlinks. Re-run this script on Linux before accepting deployment.')
    if (process.argv.includes('--require-lifecycle')) throw new Error(skipped[0])
  } else {
  const firstVersion = current()
  const firstContainer = 'a'.repeat(64), replacementContainer = 'b'.repeat(64)
  const activated = invoke('healthy')
  assert.equal(activated.status, 0, activated.output)
  assert.deepEqual(restarts(), [firstContainer])
  assert.equal(readFileSync(join(fixture, 'data/mola-turn/certs/.applied'), 'utf8').trim(), `${firstVersion.slice(9)} ${firstContainer}`)
  const unchanged = invoke('healthy')
  assert.equal(unchanged.status, 0, unchanged.output)
  assert.match(unchanged.output, /same TURN container is healthy; no restart/)
  assert.deepEqual(restarts(), [firstContainer])
  checks.push('activation marker binds certificate to full container ID; unchanged healthy container does not restart')
  for (const [mode, message] of [['none', /container is missing/], ['unhealthy', /unhealthy TURN container/], ['multiple', /at most one/], ['identitychanged', /identity changed/]]) {
    const failure = invoke(mode)
    assert.notEqual(failure.status, 0, failure.output)
    assert.match(failure.output, message)
    assert.equal(current(), firstVersion)
    assert.deepEqual(restarts(), [firstContainer])
  }
  checks.push('unchanged certificate cannot hide a missing, unhealthy, ambiguous or misidentified container')
  const replacement = invoke('healthy', { FAKE_CONTAINER_ID: replacementContainer })
  assert.equal(replacement.status, 0, replacement.output)
  assert.deepEqual(restarts(), [firstContainer, replacementContainer])
  assert.ok(readFileSync(join(fixture, 'data/mola-turn/certs/.applied'), 'utf8').includes(replacementContainer))
  checks.push('replacement container is restarted and receives its own applied marker')
  const writableVersion = invoke('healthy', { FAKE_WRITABLE_PATH: path(`data/mola-turn/certs/${firstVersion}`) })
  assert.notEqual(writableVersion.status, 0)
  assert.match(writableVersion.output, /writable by group/)
  checks.push('pre-existing writable managed certificate version is rejected')
  for (const relative of ['.deploy.lock', '.applied', `${firstVersion}/privkey.pem`]) {
    const victim = path(`data/mola-turn/certs/${relative}`)
    const saved = `${victim}.test-saved`
    write('symlink-victim', 'untouched\n')
    run(`mv -- ${quote(victim)} ${quote(saved)}; ln -s ${quote(path('symlink-victim'))} ${quote(victim)}`)
    const linked = invoke('healthy')
    assert.notEqual(linked.status, 0, linked.output)
    assert.match(linked.output, /regular and root-owned/)
    assert.equal(readFileSync(join(fixture, 'symlink-victim'), 'utf8'), 'untouched\n')
    run(`rm -- ${quote(victim)}; mv -- ${quote(saved)} ${quote(victim)}`)
  }
  checks.push('lock, applied marker and stored private-key symlinks are rejected without following them')
  openssl('x509 -req -in two.csr -CA ca.pem -CAkey ca.key -set_serial 5 -days 5 -extfile extensions -out two.pem')
  setCertificate('two')
  const failedRestart = invoke('restartfail', { FAKE_CONTAINER_ID: replacementContainer })
  assert.notEqual(failedRestart.status, 0, failedRestart.output)
  assert.match(failedRestart.output, /did not become healthy/)
  assert.equal(current(), firstVersion)
  assert.deepEqual(restarts().slice(-2), [replacementContainer, replacementContainer])
  const renewed = invoke('healthy', { FAKE_CONTAINER_ID: replacementContainer })
  assert.equal(renewed.status, 0, renewed.output)
  assert.notEqual(current(), firstVersion)
  assert.equal(restarts().at(-1), replacementContainer)
  checks.push('failed deployment restores prior pointer; corrected deployment retries the exact selected container')
  }
  console.log(JSON.stringify({ status: 'passed', checks, skipped, limitation: 'Docker, ownership and flock are fakes. Real container restart/rollback, filesystem ownership and live relay remain untested.' }, null, 2))
} finally {
  // Only this newly-created, resolved fixture inside artifacts is removed.
  assert.ok(fixture.startsWith(join(root, 'artifacts', 'turn-cert-hook-')))
  rmSync(fixture, { recursive: true, force: true })
}
