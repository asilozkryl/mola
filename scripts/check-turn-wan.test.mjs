import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { attribute, decodeAddress, packet, parsePacket, verifyIntegrity } from './check-turn-wan.mjs'

// Independent interoperability vectors from RFC 5769, sections 2.2 and 2.4:
// https://www.rfc-editor.org/rfc/rfc5769.html
const response = Buffer.from('0101003c2112a442b7e7a701bc34d686fa87dfae8022000b7465737420766563746f7220002000080001a147e112a643000800142b91f599fd9e90c38c7489f92af9ba53f06be7d780280004c07d4c96', 'hex')
const request = Buffer.from('000100602112a44278ad3433c6ad72c029da412e00060012e3839ee38388e383aae38383e382afe382b900000015001c662f2f3439396b39353464364f4c33346f4c394653547679363473410014000b6578616d706c652e6f72670000080014f67024656dd64a3e02b8e0712e85c9a28ca89666', 'hex')

test('RFC 5769 authenticated response handles trailing FINGERPRINT and decodes XOR IPv4', () => {
  const parsed = parsePacket(response)
  verifyIntegrity(parsed, Buffer.from('VOkJxbRl1RmTxUk/WvJxBt'))
  assert.deepEqual(decodeAddress(parsed.attributes.get(0x0020)), { address: '192.0.2.1', port: 32853 })
})

test('RFC 5769 long-term authenticated request is produced byte-for-byte', () => {
  const key = createHash('md5').update('マトリックス:example.org:TheMatrIX').digest()
  const bytes = packet(0x0001, [attribute(0x0006, 'マトリックス'), attribute(0x0015, 'f//499k954d6OL34oL9FSTvy64sA'), attribute(0x0014, 'example.org')], key, Buffer.from('78ad3433c6ad72c029da412e', 'hex'))
  assert.deepEqual(bytes, request)
  verifyIntegrity(parsePacket(request), key)
})

test('tampering, absent integrity and truncated attributes fail closed', () => {
  const changed = Buffer.from(response); changed[43] ^= 1
  assert.throws(() => verifyIntegrity(parsePacket(changed), Buffer.from('VOkJxbRl1RmTxUk/WvJxBt')), /integrity mismatch/)
  assert.throws(() => verifyIntegrity(parsePacket(packet(0x0101)), Buffer.from('test')), /Missing response integrity/)
  const truncated = Buffer.from(response); truncated.writeUInt16BE(65535, 22)
  assert.throws(() => parsePacket(truncated), /Truncated STUN value/)
  assert.throws(() => parsePacket(response.subarray(0, -1)), /Invalid STUN length/)
})

test('unauthenticated attributes after MESSAGE-INTEGRITY are not trusted', () => {
  const key = Buffer.from('test-key')
  const valid = packet(0x0103, [], key)
  const injected = Buffer.concat([valid, attribute(0x0016, Buffer.alloc(8))])
  injected.writeUInt16BE(injected.length - 20, 2)
  const parsed = parsePacket(injected)
  verifyIntegrity(parsed, key)
  assert.equal(parsed.attributes.has(0x0016), false)
})
