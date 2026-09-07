// Exercise the real POSIX entrypoint with synthetic hostname/kernel routes and a
// fake turnserver. This verifies startup rejection/config generation, not media.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const bash = process.env.BASH_PATH || (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash')
mkdirSync(join(root, 'artifacts'), { recursive: true })
const fixture = mkdtempSync(join(root, 'artifacts', 'turn-entrypoint-'))
const posix = path => path.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`
const path = name => posix(join(fixture, name))
const write = (name, value) => writeFileSync(join(fixture, name), value, { mode: 0o755 })
const checks = []
try {
  for (const directory of ['mock', 'certs']) mkdirSync(join(fixture, directory))
  write('certs/fullchain.pem', 'synthetic-readable-certificate')
  write('certs/privkey.pem', 'synthetic-readable-key')
  const source = readFileSync(join(root, 'ops/turn-entrypoint.sh'), 'utf8')
  write('entrypoint.sh', source.replaceAll('/etc/coturn/certs', path('certs')).replaceAll('/tmp/turnserver.conf', path('turnserver.conf')).replaceAll('/proc/net/fib_trie', path('fib_trie')))
  write('mock/hostname', '#!/bin/sh\n[ "$*" = "-i" ] || exit 9\n[ "${MOCK_IP_FAILURE:-}" != yes ] || exit 1\nprintf "%s\\n" "$MOCK_HOSTNAME_IP"\n')
  write('mock/turnserver', `#!/bin/sh\n[ "$1" = -c ] && [ "$2" = ${quote(path('turnserver.conf'))} ] || exit 9\nprintf started > ${quote(path('started'))}\n`)
  const run = (command, env = {}) => execFileSync(bash, ['--noprofile', '--norc', '-c', command], {
    cwd: fixture, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, windowsHide: true,
  })
  run(`chmod +x ${quote(path('mock'))}/*; /bin/sh -n ${quote(path('entrypoint.sh'))}`)
  const fibEntry = address => `     |-- ${address}\n        /32 host LOCAL\n`
  const fibTable = addresses => `Main:\n${fibEntry('127.0.0.1')}${addresses.map(fibEntry).join('')}Local:\n${fibEntry('127.0.0.1')}${addresses.map(fibEntry).join('')}`
  const probe = (address, extra = {}, routes = fibTable([address])) => {
    for (const name of ['started', 'turnserver.conf']) rmSync(join(fixture, name), { force: true })
    if (routes === null) rmSync(join(fixture, 'fib_trie'), { force: true })
    else write('fib_trie', routes)
    try {
      const output = run(`export PATH=${quote(path('mock'))}:"$PATH"; /bin/sh ${quote(path('entrypoint.sh'))}`, {
        TURN_REALM: 'turn.example.org', TURN_PUBLIC_IP: '72.62.234.232', TURN_SECRET: 'test-only-secret-never-use-in-production', MOCK_HOSTNAME_IP: address, ...extra,
      })
      assert.ok(!output.includes('test-only-secret'))
      return { status: 0, output }
    } catch (error) { return { status: error.status, output: `${error.stdout || ''}${error.stderr || ''}` } }
  }
  for (const address of ['10.0.6.3', '172.18.0.7', '192.168.50.9']) {
    const result = probe(address)
    assert.equal(result.status, 0, result.output)
    assert.equal(readFileSync(join(fixture, 'started'), 'utf8'), 'started')
    const config = readFileSync(join(fixture, 'turnserver.conf'), 'utf8')
    assert.ok(config.includes(`\nrelay-ip=${address}\nexternal-ip=72.62.234.232/${address}\n`))
    assert.equal(config.split('\n').filter(line => /^(external-ip|relay-ip)=/.test(line)).length, 2)
    assert.ok(!/^allowed-peer-ip=/m.test(config), 'No extra peer range exceptions are needed')
    for (const line of source.split('\n').filter(line => line.startsWith('denied-peer-ip='))) assert.ok(config.includes(`\n${line}\n`))
  }
  checks.push('each startup discovers its own IPv4 and maps only that relay address while preserving all private-peer bans')
  for (const [name, address, env, routes] of [
    ['missing interface', '', {}],
    ['ambiguous hostname', '10.0.6.3 172.18.0.7', {}],
    ['loopback', '127.0.0.1', {}],
    ['metadata/link-local', '169.254.169.254', {}],
    ['unspecified', '0.0.0.0', {}],
    ['multicast', '224.0.0.1', {}],
    ['out-of-range octet', '10.0.6.999', {}],
    ['ambiguous leading zero', '010.0.6.3', {}],
    ['unexpected text', 'bad-address', {}],
    ['failed hostname discovery', '10.0.6.3', { MOCK_IP_FAILURE: 'yes' }],
    ['hostname points to gateway', '10.0.6.1', {}, fibTable(['10.0.6.3'])],
    ['ambiguous kernel addresses', '10.0.6.3', {}, fibTable(['10.0.6.3', '172.18.0.7'])],
    ['missing kernel route file', '10.0.6.3', {}, null],
    ['empty kernel routes', '10.0.6.3', {}, ''],
    ['unicast route is not a local interface', '10.0.6.3', {}, fibTable(['10.0.6.3']).replaceAll('host LOCAL', 'universe UNICAST')],
  ]) {
    const result = probe(address, env, routes)
    assert.notEqual(result.status, 0, `${name} must fail`)
    assert.equal(existsSync(join(fixture, 'started')), false, `${name} must not start coturn`)
    assert.equal(existsSync(join(fixture, 'turnserver.conf')), false, `${name} must fail before writing config`)
  }
  checks.push('15 invalid, ambiguous, non-local or failed discovery cases reject startup before config/turnserver execution')
  console.log(JSON.stringify({ status: 'passed', checks, limitation: 'Hostname/kernel route inputs and turnserver are fakes; verify relay-to-relay media and private-peer rejection on the pinned container.' }, null, 2))
} finally {
  assert.ok(fixture.startsWith(join(root, 'artifacts', 'turn-entrypoint-')))
  rmSync(fixture, { recursive: true, force: true })
}
