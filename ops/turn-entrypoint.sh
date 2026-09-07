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
# Discover this network namespace's own address; never trust a configured peer
# exception or a Docker IP saved from an earlier deployment. Verify hostname
# resolution against the kernel's LOCAL routes; no ip/BusyBox package is needed.
turn_local_ip=$(hostname -i) || { echo 'Cannot discover TURN relay IPv4' >&2; exit 1; }
printf '%s\n' "$turn_local_ip" | awk '
  NF != 1 {exit 1}
  {count++; if ($0 !~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/) exit 1;
   split($0,a,"."); for(i=1;i<=4;i++) if(a[i]>255 || (length(a[i])>1 && substr(a[i],1,1)=="0")) exit 1;
   if(a[1]==0 || a[1]==127 || a[1]>=224 || (a[1]==169 && a[2]==254)) exit 1}
  END {if(count!=1) exit 1}
' || { echo 'TURN requires exactly one usable non-loopback local IPv4' >&2; exit 1; }
awk -v expected="$turn_local_ip" '
  $1=="|--" {address=$2}
  $1=="/32" && $2=="host" && $3=="LOCAL" && address !~ /^127\./ {addresses[address]=1}
  END {for(address in addresses) count++; if(count!=1 || !(expected in addresses)) exit 1}
' /proc/net/fib_trie || { echo 'TURN hostname must match the sole local IPv4 in this network namespace' >&2; exit 1; }
umask 077
cat > /tmp/turnserver.conf <<EOF
listening-port=3478
tls-listening-port=5349
min-port=49160
max-port=49259
# The explicit mapping permits only this relay's own address through the
# private-range ACL, allowing two allocations on this server to exchange ICE.
# Coturn 4.17.2 automatically whitelists the private half of this mapping.
relay-ip=$turn_local_ip
external-ip=$TURN_PUBLIC_IP/$turn_local_ip
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
