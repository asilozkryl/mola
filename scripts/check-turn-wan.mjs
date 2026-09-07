// External TURN acceptance probe; no browser, Docker or third-party test service.
// Run from a machine outside the TURN server's network. Credentials must be
// short-lived TURN REST credentials, never the server's shared TURN_SECRET.
//
// TURN_HOST=turn.example.org TURN_EXPECTED_RELAY_IP=<public IPv4>
// TURN_CREDENTIALS_FILE=<ignored private JSON file containing username/password>
// node scripts/check-turn-wan.mjs
//
// TLS certificate validation and hostname checking are always enabled. Each
// transport obtains a real allocation and exchanges random data with a separate
// local UDP peer through the public relay port. This proves the WAN relay path,
// but does not replace a two-device browser call/screen-sharing acceptance test.
// Wire format: RFC 5389 sections 6, 15.4; RFC 8656 sections 6, 9 and 10.
import assert from 'node:assert/strict'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import dgram from 'node:dgram'
import { lookup } from 'node:dns/promises'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import net from 'node:net'
import tls from 'node:tls'
import { pathToFileURL } from 'node:url'

const COOKIE = 0x2112a442
const ATTR = { username: 0x0006, integrity: 0x0008, error: 0x0009, lifetime: 0x000d, peer: 0x0012, data: 0x0013, realm: 0x0014, nonce: 0x0015, relay: 0x0016, transport: 0x0019, mapped: 0x0020 }
const uint32 = value => { const b = Buffer.alloc(4); b.writeUInt32BE(value); return b }
const longTermKey = (username, realm, password) => createHash('md5').update(`${username}:${realm}:${password}`).digest()

export function attribute(type, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value)
  const result = Buffer.alloc(4 + ((bytes.length + 3) & ~3))
  result.writeUInt16BE(type); result.writeUInt16BE(bytes.length, 2); bytes.copy(result, 4)
  return result
}

export function packet(type, attributes = [], key, transaction = randomBytes(12)) {
  const body = Buffer.concat(attributes)
  const header = Buffer.alloc(20)
  header.writeUInt16BE(type); header.writeUInt16BE(body.length + (key ? 24 : 0), 2)
  header.writeUInt32BE(COOKIE, 4); transaction.copy(header, 8)
  const prefix = Buffer.concat([header, body])
  return key ? Buffer.concat([prefix, attribute(ATTR.integrity, createHmac('sha1', key).update(prefix).digest())]) : prefix
}

export function parsePacket(bytes) {
  assert.ok(bytes.length >= 20 && !(bytes[0] & 0xc0) && bytes.readUInt32BE(4) === COOKIE, 'Invalid STUN header')
  assert.equal(bytes.readUInt16BE(2) + 20, bytes.length, 'Invalid STUN length')
  assert.equal(bytes.length % 4, 0, 'Invalid STUN padding')
  const attributes = new Map()
  let integrityOffset
  for (let offset = 20; offset < bytes.length;) {
    assert.ok(offset + 4 <= bytes.length, 'Truncated STUN attribute')
    const type = bytes.readUInt16BE(offset), length = bytes.readUInt16BE(offset + 2)
    assert.ok(offset + 4 + ((length + 3) & ~3) <= bytes.length, 'Truncated STUN value')
    // Anything after MESSAGE-INTEGRITY except fingerprint is unauthenticated.
    if (integrityOffset === undefined && !attributes.has(type)) attributes.set(type, bytes.subarray(offset + 4, offset + 4 + length))
    if (type === ATTR.integrity && integrityOffset === undefined) integrityOffset = offset
    offset += 4 + ((length + 3) & ~3)
  }
  return { bytes, type: bytes.readUInt16BE(0), transaction: bytes.subarray(8, 20), attributes, integrityOffset }
}

export function verifyIntegrity(message, key) {
  const value = message.attributes.get(ATTR.integrity)
  assert.ok(value?.length === 20 && message.integrityOffset !== undefined, 'Missing response integrity')
  const prefix = Buffer.from(message.bytes.subarray(0, message.integrityOffset))
  prefix.writeUInt16BE(message.integrityOffset + 24 - 20, 2)
  assert.ok(timingSafeEqual(createHmac('sha1', key).update(prefix).digest(), value), 'Response integrity mismatch')
}

export function decodeAddress(value) {
  assert.ok(value?.length === 8 && value[1] === 1, 'Expected IPv4 XOR address')
  const address = uint32((value.readUInt32BE(4) ^ COOKIE) >>> 0)
  return { address: [...address].join('.'), port: value.readUInt16BE(2) ^ (COOKIE >>> 16) }
}

function encodeAddress({ address, port }) {
  assert.equal(net.isIP(address), 4, 'Expected IPv4 peer')
  const value = Buffer.alloc(8)
  value[1] = 1; value.writeUInt16BE(port ^ (COOKIE >>> 16), 2)
  value.writeUInt32BE((Buffer.from(address.split('.').map(Number)).readUInt32BE() ^ COOKIE) >>> 0, 4)
  return value
}

function waitFor(emitter, event, predicate, label, timeout = 8000, send) {
  return new Promise((resolve, reject) => {
    let retry, delay = 500
    const cleanup = () => { clearTimeout(timer); clearTimeout(retry); emitter.off(event, receive); emitter.off('error', fail) }
    const fail = error => { cleanup(); reject(error) }
    const receive = (...args) => {
      try { if (predicate(...args)) { cleanup(); resolve(args[0]) } } catch (error) { fail(error) }
    }
    const transmit = () => {
      try { send?.(); if (send) { retry = setTimeout(transmit, delay); delay *= 2 } } catch (error) { fail(error) }
    }
    const timer = setTimeout(() => fail(new Error(`${label}: timed out`)), timeout)
    emitter.on(event, receive); emitter.on('error', fail)
    if (send) transmit()
  })
}

async function openControl(transport, host, address, port) {
  const socket = transport === 'udp' ? dgram.createSocket('udp4') : transport === 'tls'
    ? tls.connect({ host: address, port, servername: host, rejectUnauthorized: true, minVersion: 'TLSv1.2' })
    : net.connect({ host: address, port })
  const events = new EventEmitter()
  // Keep errors handled between requests too; a later request sees the failure.
  events.on('error', () => {})
  let failure, buffer = Buffer.alloc(0), closed = false
  socket.on('error', error => { failure = error; events.emit('error', error) })
  const accept = bytes => {
    try { events.emit('packet', parsePacket(bytes)) } catch (error) { failure = error; events.emit('error', error) }
  }
  if (transport === 'udp') {
    socket.on('message', accept)
    const connected = waitFor(socket, 'connect', () => true, 'UDP connection')
    socket.connect(port, address)
    try { await connected } catch (error) { try { socket.close() } catch {} throw error }
  } else {
    socket.on('data', bytes => {
      buffer = Buffer.concat([buffer, bytes])
      while (buffer.length >= 20) {
        const size = 20 + buffer.readUInt16BE(2)
        if (size > buffer.length) break
        accept(buffer.subarray(0, size)); buffer = buffer.subarray(size)
      }
    })
    try { await waitFor(socket, transport === 'tls' ? 'secureConnect' : 'connect', () => true, `${transport} connection`) }
    catch (error) { socket.destroy(); throw error }
  }
  socket.on('close', () => {
    if (!closed) { failure = new Error(`${transport} connection closed`); events.emit('error', failure) }
  })
  const send = bytes => {
    if (failure) throw failure
    if (transport === 'udp') socket.send(bytes)
    else socket.write(bytes)
  }
  return {
    events, send, tlsProtocol: transport === 'tls' ? socket.getProtocol() : undefined,
    request: async (bytes, label, timeout = 8000) => {
      if (failure) throw failure
      const result = waitFor(events, 'packet', message => message.transaction.equals(bytes.subarray(8, 20)), label, timeout,
        transport === 'udp' ? () => send(bytes) : undefined)
      if (transport !== 'udp') send(bytes)
      return result
    },
    close: () => { closed = true; if (transport === 'udp') socket.close(); else socket.destroy() },
  }
}

function errorCode(message) {
  const value = message.attributes.get(ATTR.error)
  return value && value.length >= 4 ? (value[2] & 7) * 100 + value[3] : undefined
}

async function checkTransport(transport, config, credentials) {
  const port = transport === 'tls' ? 5349 : 3478
  const control = await openControl(transport, config.host, config.address, port)
  let auth, allocated = false, peer
  const authenticated = async (method, attributes, label, timeout) => {
    for (let retry = 0; retry < 2; retry++) {
      const bytes = packet(method, [...attributes,
        attribute(ATTR.username, credentials.username), attribute(ATTR.realm, auth.realm), attribute(ATTR.nonce, auth.nonce)], auth.key)
      const response = await control.request(bytes, label, timeout)
      if (errorCode(response) === 438 && retry === 0) {
        // Existing key must validate the stale-nonce response before accepting it.
        verifyIntegrity(response, auth.key)
        auth.nonce = response.attributes.get(ATTR.nonce)
        assert.ok(auth.nonce?.length, 'Stale nonce response omitted nonce')
        continue
      }
      verifyIntegrity(response, auth.key)
      assert.equal(response.type, method | 0x0100, `${label}: TURN response code ${errorCode(response) ?? 'invalid'}`)
      return response
    }
  }
  try {
    const requested = [attribute(ATTR.transport, Buffer.from([17, 0, 0, 0])), attribute(ATTR.lifetime, uint32(60))]
    const challenge = await control.request(packet(0x0003, requested), 'Unauthenticated allocation challenge')
    assert.equal(challenge.type, 0x0113, 'Unauthenticated allocation was not rejected')
    assert.equal(errorCode(challenge), 401, 'Expected TURN authentication challenge')
    const realm = challenge.attributes.get(ATTR.realm), nonce = challenge.attributes.get(ATTR.nonce)
    assert.ok(realm?.length && nonce?.length, 'Missing TURN realm or nonce')
    assert.equal(realm.toString(), config.realm, 'Unexpected TURN realm')
    auth = { realm, nonce, key: longTermKey(credentials.username, realm.toString(), credentials.password) }
    const allocation = await authenticated(0x0003, requested, 'Authenticated allocation')
    allocated = true
    const relay = decodeAddress(allocation.attributes.get(ATTR.relay))
    assert.equal(relay.address, config.expectedIp, 'Relay IP does not match expected public VPS')
    assert.ok(relay.port >= 49160 && relay.port <= 49259, 'Relay port outside configured range')

    // Discover this separate UDP peer's public IP via our own server, then send
    // directly to the relay. Learning its port from the DATA indication works
    // even when NAT gives a different port per remote destination.
    peer = dgram.createSocket('udp4')
    peer.on('error', () => {})
    const binding = packet(0x0001)
    const bindingResponse = await waitFor(peer, 'message', (bytes, remote) => remote.address === config.address && remote.port === 3478
      && bytes.length >= 20 && bytes.subarray(8, 20).equals(binding.subarray(8, 20)), 'Peer STUN discovery', 8000,
    () => peer.send(binding, 3478, config.address))
    const mappedMessage = parsePacket(bindingResponse)
    assert.equal(mappedMessage.type, 0x0101, 'Peer STUN discovery failed')
    const mapped = decodeAddress(mappedMessage.attributes.get(ATTR.mapped))
    assert.notEqual(mapped.address, config.expectedIp, 'Run this WAN probe outside the TURN server network')
    await authenticated(0x0008, [attribute(ATTR.peer, encodeAddress(mapped))], 'Create permission')

    const sent = randomBytes(256), returned = randomBytes(256)
    const inbound = await waitFor(control.events, 'packet', message => message.type === 0x0017 && message.attributes.get(ATTR.data)?.equals(sent),
      'External UDP peer to TURN client', 8000, () => peer.send(sent, relay.port, relay.address))
    const peerAddress = decodeAddress(inbound.attributes.get(ATTR.peer))
    assert.equal(peerAddress.address, mapped.address, 'Relay reported an unexpected peer')
    await waitFor(peer, 'message', (bytes, remote) => remote.address === relay.address && remote.port === relay.port && bytes.equals(returned),
      'TURN client to external UDP peer', 8000, () => control.send(packet(0x0016, [attribute(ATTR.peer, encodeAddress(peerAddress)), attribute(ATTR.data, returned)])))
    const result = { transport, port, status: 'passed', unauthenticatedRejected: true, authenticatedAllocation: true,
      responseIntegrity: true, relay, bytesPeerToClient: sent.length, bytesClientToPeer: returned.length }
    if (control.tlsProtocol) result.tls = { protocol: control.tlsProtocol, certificateAndHostnameVerified: true }
    // Release server resources explicitly. A short requested lifetime also bounds
    // the allocation if the control path becomes unavailable during cleanup.
    await authenticated(0x0004, [attribute(ATTR.lifetime, uint32(0))], 'Release allocation', 3000)
    allocated = false; result.allocationReleased = true
    return result
  } finally {
    if (allocated && auth) await authenticated(0x0004, [attribute(ATTR.lifetime, uint32(0))], 'Cleanup allocation', 2000).catch(() => {})
    if (peer) { try { peer.close() } catch {} }
    control.close()
  }
}

export async function main() {
  const config = { host: process.env.TURN_HOST, expectedIp: process.env.TURN_EXPECTED_RELAY_IP, realm: process.env.TURN_REALM || process.env.TURN_HOST }
  assert.ok(config.host && /^[a-z0-9.-]+$/i.test(config.host), 'Set TURN_HOST to the certificate hostname')
  assert.equal(net.isIP(config.expectedIp), 4, 'Set TURN_EXPECTED_RELAY_IP to the public VPS IPv4')
  let credentials
  try {
    const text = readFileSync(process.env.TURN_CREDENTIALS_FILE, 'utf8')
    if (text.length > 4096) throw new Error()
    credentials = JSON.parse(text)
    if (typeof credentials.username !== 'string' || typeof credentials.password !== 'string'
      || !/^\d+:[A-Za-z0-9_-]+$/.test(credentials.username) || !/^[A-Za-z0-9+/]+={0,2}$/.test(credentials.password)) throw new Error()
    const expires = Number(credentials.username.split(':')[0])
    if (expires < Date.now() / 1000 + 120 || expires > Date.now() / 1000 + 3600) throw new Error()
  } catch { throw new Error('TURN_CREDENTIALS_FILE must contain valid short-lived username/password JSON, expiring in 2–60 minutes') }
  config.address = (await lookup(config.host, { family: 4 })).address
  assert.equal(config.address, config.expectedIp, 'TURN DNS does not resolve directly to the expected VPS')
  const results = []
  for (const transport of ['udp', 'tcp', 'tls']) {
    try { results.push(await checkTransport(transport, config, credentials)) }
    catch (error) {
      // Do not log packets, usernames, passwords or native assertion actuals.
      const message = String(error.message).split('\n')[0].replaceAll(credentials.username, '[redacted]').replaceAll(credentials.password, '[redacted]')
      results.push({ transport, status: 'failed', error: message })
    }
    console.log(JSON.stringify(results.at(-1)))
  }
  if (results.some(result => result.status !== 'passed')) process.exitCode = 1
  return results
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(JSON.stringify({ status: 'failed', error: String(error.message).split('\n')[0] })); process.exitCode = 1 })
}
