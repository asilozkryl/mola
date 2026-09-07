#!/bin/sh
set -eu
: "${TURN_REALM:?Set TURN_REALM to the relay DNS name}"
: "${TURN_PUBLIC_IP:?Set TURN_PUBLIC_IP to the routable IPv4 address}"
: "${TURN_SECRET:?Set TURN_SECRET to the same secret used by Mola}"
case "$TURN_REALM" in *[!A-Za-z0-9.-]*) echo 'Invalid TURN_REALM' >&2; exit 1;; esac
case "$TURN_PUBLIC_IP" in *[!0-9.]*|127.*|10.*|192.168.*|0.*|169.254.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*|100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*|22[4-9].*|2[3-5][0-9].*) echo 'TURN_PUBLIC_IP must be public IPv4' >&2; exit 1;; esac
printf '%s\n' "$TURN_PUBLIC_IP" | awk -F. 'NF != 4 {exit 1} {for(i=1;i<=4;i++) if ($i=="" || $i<0 || $i>255) exit 1}'
case "$TURN_SECRET" in *[!A-Za-z0-9_=-]*) echo 'TURN_SECRET must use base64url or hex characters' >&2; exit 1;; esac
test "${#TURN_SECRET}" -ge 32
test -r /etc/coturn/certs/fullchain.pem && test -r /etc/coturn/certs/privkey.pem
umask 077
cat > /tmp/turnserver.conf <<EOF
listening-port=3478
tls-listening-port=5349
min-port=49160
max-port=49259
external-ip=$TURN_PUBLIC_IP
realm=$TURN_REALM
use-auth-secret
static-auth-secret=$TURN_SECRET
fingerprint
no-multicast-peers
# Pinned coturn 4.17 defaults to TLS 1.2+, CLI off, and DTLS off.
# The removed no-tlsv1/no-tlsv1_1 switches are no longer recognized.
cert=/etc/coturn/certs/fullchain.pem
pkey=/etc/coturn/certs/privkey.pem
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
total-quota=200
# Bytes/second: 20 Mbit/s per allocation, 800 Mbit/s for the relay.
# Coturn requires max-bps when bps-capacity is configured.
max-bps=2500000
bps-capacity=100000000
stale-nonce=600
log-file=stdout
simple-log
pidfile=/tmp/turn.pid
EOF
exec turnserver -c /tmp/turnserver.conf
