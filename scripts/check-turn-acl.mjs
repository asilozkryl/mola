// Run on the VPS; temporary REST credentials stay in a private file there.
// TURN_CREDENTIALS_FILE=/root/<private temporary credentials>.json
// TURN_GATEWAY=10.0.6.1 node scripts/check-turn-acl.mjs
//
// Tests CREATE_PERMISSION only. No Send indication, ChannelBind, or peer data is
// ever transmitted. The public relay address is a positive control; private
// addresses must each return an authenticated 403. Allocation is always released.
import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { readFileSync, statSync } from 'node:fs'
import { isIP } from 'node:net'
import { isAbsolute } from 'node:path'
import tls from 'node:tls'
import { pathToFileURL } from 'node:url'
import { attribute, packet, parsePacket, verifyIntegrity, decodeAddress } from './check-turn-wan.mjs'

const A = { username: 0x0006, error: 0x0009, lifetime: 0x000d, peer: 0x0012, realm: 0x0014, nonce: 0x0015, relay: 0x0016, transport: 0x0019 }
class ProbeError extends Error { constructor(code) { super(code); this.code = code } }
const check = (condition, code) => { if (!condition) throw new ProbeError(code) }
const uint32 = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes }
const errorCode = response => { const value = response.attributes.get(A.error); return value?.length >= 4 ? (value[2] & 7) * 100 + value[3] : undefined }
const safeCode = error => error instanceof ProbeError ? error.code : /^[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'PROBE_OPERATION_FAILED'

function readCredentials() {
  try {
    const path = process.env.TURN_CREDENTIALS_FILE
    if (!path || !isAbsolute(path)) throw new Error()
    const metadata = statSync(path)
    if (!metadata.isFile() || metadata.size > 4096) throw new Error()
    if (process.platform !== 'win32' && ((metadata.mode & 0o077) !== 0 || metadata.uid !== process.getuid())) throw new Error()
    const value = JSON.parse(readFileSync(path, 'utf8'))
    const username = value.username, password = value.password ?? value.credential
    if (typeof username !== 'string' || typeof password !== 'string'
      || !/^\d+:[A-Za-z0-9_-]+$/.test(username) || !/^[A-Za-z0-9+/]+={0,2}$/.test(password)) throw new Error()
    const remaining = Number(username.split(':')[0]) - Date.now() / 1000
    if (remaining < 120 || remaining > 3600) throw new Error()
    return { username, password }
  } catch { throw new ProbeError('INVALID_PRIVATE_TEMPORARY_CREDENTIAL_FILE') }
}

function xorPeerAddress(address, port) {
  check(isIP(address) === 4, 'INVALID_PEER_IPV4')
  const value = Buffer.alloc(8)
  value[1] = 1; value.writeUInt16BE(port ^ 0x2112, 2)
  value.writeUInt32BE((Buffer.from(address.split('.').map(Number)).readUInt32BE() ^ 0x2112a442) >>> 0, 4)
  return value
}

async function connectTls(host, address) {
  const socket = tls.connect({ host: address, port: 5349, servername: host, rejectUnauthorized: true, minVersion: 'TLSv1.2' })
  let pending, failure, startup, buffer = Buffer.alloc(0), closing = false
  const fail = error => {
    failure ??= new ProbeError(safeCode(error))
    if (startup) { startup.reject(failure); startup = undefined }
    if (pending) { clearTimeout(pending.timer); pending.reject(failure); pending = undefined }
    socket.destroy()
  }
  socket.on('error', fail)
  socket.on('close', () => { if (!closing && !failure) fail(new ProbeError('TLS_CONNECTION_CLOSED')) })
  socket.on('data', bytes => {
    buffer = Buffer.concat([buffer, bytes])
    try {
      while (buffer.length >= 20) {
        const length = 20 + buffer.readUInt16BE(2)
        if (buffer.length < length) break
        const message = parsePacket(buffer.subarray(0, length))
        buffer = buffer.subarray(length)
        if (pending && message.transaction.equals(pending.transaction)) {
          const completion = pending; pending = undefined; clearTimeout(completion.timer); completion.resolve(message)
        }
      }
    } catch { fail(new ProbeError('INVALID_STUN_RESPONSE')) }
  })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(new ProbeError('TLS_CONNECTION_TIMEOUT')), 8000)
    startup = { reject: error => { clearTimeout(timer); reject(error) } }
    socket.once('secureConnect', () => { clearTimeout(timer); startup = undefined; resolve() })
  })
  return {
    protocol: socket.getProtocol(),
    request(bytes, timeout = 8000) {
      return new Promise((resolve, reject) => {
        if (failure) { reject(failure); return }
        if (pending) { reject(new ProbeError('CONCURRENT_STUN_REQUEST')); return }
        const timer = setTimeout(() => fail(new ProbeError('STUN_RESPONSE_TIMEOUT')), timeout)
        pending = { resolve, reject, timer, transaction: bytes.subarray(8, 20) }
        socket.write(bytes)
      })
    },
    close() { closing = true; socket.destroy() },
  }
}

export async function main() {
  const host = process.env.TURN_HOST || 'turn.psychodry.cloud'
  const realm = process.env.TURN_REALM || host
  const expectedIp = process.env.TURN_EXPECTED_RELAY_IP || '72.62.234.232'
  const gateway = process.env.TURN_GATEWAY || '10.0.6.1'
  check(/^[A-Za-z0-9.-]+$/.test(host), 'INVALID_TURN_HOST')
  check(isIP(expectedIp) === 4 && isIP(gateway) === 4, 'INVALID_IPV4_CONFIGURATION')
  const credentials = readCredentials()
  const address = (await lookup(host, { family: 4 })).address
  check(address === expectedIp, 'TURN_DNS_DIFFERS_FROM_EXPECTED_VPS')
  const report = { target: host, transport: 'tls', port: 5349, status: 'running', checks: [], allocationReleased: false }
  const control = await connectTls(host, address)
  report.tls = { protocol: control.protocol, certificateAndHostnameVerified: true }
  let auth, allocated = false
  const authenticated = async (method, attributes, timeout) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const bytes = packet(method, [...attributes, attribute(A.username, credentials.username), attribute(A.realm, auth.realm), attribute(A.nonce, auth.nonce)], auth.key)
      const response = await control.request(bytes, timeout)
      try { verifyIntegrity(response, auth.key) } catch { throw new ProbeError('RESPONSE_INTEGRITY_FAILED') }
      if (errorCode(response) === 438 && attempt === 0) {
        const nonce = response.attributes.get(A.nonce)
        check(Boolean(nonce?.length), 'STALE_NONCE_RESPONSE_MISSING_NONCE')
        auth.nonce = nonce; continue
      }
      check(response.type === (method | 0x0100) || response.type === (method | 0x0110), 'UNEXPECTED_STUN_RESPONSE_TYPE')
      return response
    }
  }
  try {
    const attributes = [attribute(A.transport, Buffer.from([17, 0, 0, 0])), attribute(A.lifetime, uint32(60))]
    const challenge = await control.request(packet(0x0003, attributes))
    check(challenge.type === 0x0113 && errorCode(challenge) === 401, 'UNAUTHENTICATED_ALLOCATION_NOT_REJECTED')
    const realmValue = challenge.attributes.get(A.realm), nonce = challenge.attributes.get(A.nonce)
    check(realmValue?.toString() === realm && Boolean(nonce?.length), 'INVALID_AUTHENTICATION_CHALLENGE')
    auth = { realm: realmValue, nonce, key: createHash('md5').update(`${credentials.username}:${realm}:${credentials.password}`).digest() }
    const allocation = await authenticated(0x0003, attributes)
    check(allocation.type === 0x0103, 'AUTHENTICATED_ALLOCATION_FAILED')
    allocated = true
    const relay = decodeAddress(allocation.attributes.get(A.relay))
    check(relay.address === expectedIp && relay.port >= 49160 && relay.port <= 49259, 'UNEXPECTED_PUBLIC_RELAY_ADDRESS')
    report.authenticatedAllocation = true
    for (const peer of [...new Set([gateway, '10.1.2.3', '172.16.1.1', '192.168.1.1', '169.254.169.254', '127.0.0.1'])]) {
      const response = await authenticated(0x0008, [attribute(A.peer, xorPeerAddress(peer, 9))])
      const code = errorCode(response)
      report.checks.push({ peer, operation: 'CREATE_PERMISSION', expected: 403, actual: response.type === 0x0108 ? 'success' : code ?? 'invalid',
        integrityVerified: true, status: response.type === 0x0118 && code === 403 ? 'passed' : 'failed' })
    }
    const positive = await authenticated(0x0008, [attribute(A.peer, xorPeerAddress(relay.address, relay.port))])
    report.checks.push({ peer: relay.address, operation: 'CREATE_PERMISSION', expected: 'success', actual: positive.type === 0x0108 ? 'success' : errorCode(positive) ?? 'invalid',
      integrityVerified: true, status: positive.type === 0x0108 ? 'passed' : 'failed' })
  } catch (error) {
    report.error = safeCode(error)
  } finally {
    if (allocated && auth) {
      try {
        const released = await authenticated(0x0004, [attribute(A.lifetime, uint32(0))], 3000)
        report.allocationReleased = released.type === 0x0104 && released.attributes.get(A.lifetime)?.readUInt32BE() === 0
      } catch { report.allocationReleased = false }
    }
    control.close()
    credentials.username = ''; credentials.password = ''
  }
  report.status = !report.error && report.allocationReleased && report.checks.length >= 6 && report.checks.every(result => result.status === 'passed') ? 'passed' : 'failed'
  report.peerPayloadsSent = 0
  console.log(JSON.stringify(report, null, 2))
  if (report.status !== 'passed') process.exitCode = 1
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(JSON.stringify({ status: 'failed', error: safeCode(error), peerPayloadsSent: 0 })); process.exitCode = 1 })
}
