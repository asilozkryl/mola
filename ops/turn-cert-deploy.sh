#!/bin/bash
# Ubuntu host Certbot deploy hook. Install root-owned; never mount Docker's
# socket into coturn or a certificate helper container. See docs/HOSTINGER.md.
set -euo pipefail
umask 077

readonly realm=turn.psychodry.cloud
readonly lineage=/etc/letsencrypt/live/turn.psychodry.cloud
readonly target=/data/mola-turn/certs
readonly config=/etc/mola-turn/cert-deploy.conf

fail() { printf 'Mola TURN certificate: %s\n' "$*" >&2; exit 1; }
log() { printf 'Mola TURN certificate: %s\n' "$*"; }
trusted_directory() {
  [[ -d $1 && ! -L $1 && $(stat -c %u "$1") == 0 ]] || fail "directory must be root-owned and not a symlink: $1"
  local mode
  mode=$(stat -c %a "$1")
  (( (8#$mode & 0022) == 0 )) || fail "directory is writable by group/others: $1"
}
trusted_file() {
  [[ -f $1 && ! -L $1 && $(stat -c %u "$1") == 0 ]] || fail "file must be regular and root-owned: $1"
  local mode
  mode=$(stat -c %a "$1")
  (( (8#$mode & 0022) == 0 )) || fail "file is writable by group/others: $1"
}
trusted_version() {
  trusted_directory "$1"
  trusted_file "$1/fullchain.pem"
  trusted_file "$1/privkey.pem"
  local mode
  mode=$(stat -c %a "$1/privkey.pem")
  (( (8#$mode & 0007) == 0 )) || fail 'stored private key is accessible to others'
}

[[ ${RENEWED_LINEAGE:-} == "$lineage" ]] || exit 0
[[ $(id -u) == 0 ]] || fail 'run this hook as root'
for command in openssl flock docker install sha256sum readlink stat; do
  command -v "$command" >/dev/null || fail "missing command: $command"
done
# Protected leaf entries are insufficient if an ancestor can be replaced.
for ancestor in "${config%/*}" "${target%/*/*}"; do
  while [[ $ancestor != / ]]; do
    trusted_directory "$ancestor"
    ancestor=${ancestor%/*}
    [[ -n $ancestor ]] || ancestor=/
  done
done
trusted_file "$config"
# Root-owned configuration contains only TURN_COMPOSE_PROJECT.
# shellcheck source=/dev/null
source "$config"
[[ ${TURN_COMPOSE_PROJECT:-} =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || fail 'set the exact TURN Compose project in config'

# Do not follow a pre-existing directory symlink or silently adopt a directory
# writable by another user. Parent directories also protect the private key.
for directory in /data/mola-turn "$target" "$target/versions"; do
  [[ ! -L $directory ]] || fail "directory must not be a symlink: $directory"
  if [[ -e $directory ]]; then
    trusted_directory "$directory"
  fi
  install -d -o root -g 65534 -m 0750 "$directory"
done
for file in "$target/.deploy.lock" "$target/.applied"; do
  if [[ -e $file || -L $file ]]; then trusted_file "$file"; fi
done
exec 9>"$target/.deploy.lock"
flock -w 120 9 || fail 'another certificate deployment is still running'
rm -f -- "$target/.current.next" "$target/.applied.next"

stage=$(mktemp -d "$target/versions/.new.XXXXXXXX")
cleanup() {
  [[ -z ${stage:-} ]] || rm -rf -- "$stage"
  rm -f -- "$target/.current.next" "$target/.applied.next"
}
trap cleanup EXIT
install -o root -g 65534 -m 0640 "$lineage/fullchain.pem" "$stage/fullchain.pem"
install -o root -g 65534 -m 0640 "$lineage/privkey.pem" "$stage/privkey.pem"

# Validate the staged bytes, not mutable Certbot symlinks. Check validity,
# public trust, hostname and public-key equality before exposing either file.
openssl x509 -in "$stage/fullchain.pem" -noout -checkend 86400 >/dev/null || fail 'certificate expires within 24 hours'
openssl verify -purpose sslserver -verify_hostname "$realm" \
  -CAfile /etc/ssl/certs/ca-certificates.crt \
  -untrusted "$stage/fullchain.pem" "$stage/fullchain.pem" >/dev/null || fail 'certificate trust, hostname or validity check failed'
cert_public=$(openssl x509 -in "$stage/fullchain.pem" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum)
key_public=$(openssl pkey -in "$stage/privkey.pem" -pubout -outform DER | sha256sum)
[[ $cert_public == "$key_public" ]] || fail 'certificate and private key do not match'
version=$(sha256sum "$stage/fullchain.pem" | cut -d ' ' -f 1)
[[ $version =~ ^[a-f0-9]{64}$ ]] || fail 'invalid certificate digest'

# Existing unmanaged files are left untouched. Both public names always resolve
# through the same current pointer, switched atomically after pair validation.
for file in fullchain.pem privkey.pem; do
  if [[ -e $target/$file || -L $target/$file ]]; then
    [[ -L $target/$file && $(readlink "$target/$file") == "current/$file" ]] || fail "unmanaged file exists: $target/$file"
  else
    ln -s "current/$file" "$target/$file"
  fi
done
old=''
if [[ -e $target/current || -L $target/current ]]; then
  [[ -L $target/current ]] || fail 'current must be a managed symlink'
  old=$(readlink "$target/current")
  [[ $old =~ ^versions/[a-f0-9]{64}$ ]] || fail 'current points outside managed versions'
  trusted_version "$target/$old"
fi
if [[ -e $target/versions/$version || -L $target/versions/$version ]]; then
  trusted_version "$target/versions/$version"
  cmp -s "$stage/fullchain.pem" "$target/versions/$version/fullchain.pem" && \
    cmp -s "$stage/privkey.pem" "$target/versions/$version/privkey.pem" || fail 'stored certificate version differs'
else
  chown root:65534 "$stage"
  chmod 0750 "$stage"
  mv -- "$stage" "$target/versions/$version"
  stage=''
fi

# A project and service label together identify this one resource. A broad
# name/image match could restart an unrelated application; never use one here.
containers=$(docker ps --quiet --no-trunc \
  --filter "label=com.docker.compose.project=$TURN_COMPOSE_PROJECT" \
  --filter 'label=com.docker.compose.service=turn') || fail 'could not list TURN containers'
container=''
if [[ -n $containers ]]; then
  [[ $containers =~ ^[a-f0-9]{64}$ ]] || fail 'expected at most one running TURN container'
  container=$containers
  [[ $(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}/{{index .Config.Labels "com.docker.compose.service"}}' "$container") == "$TURN_COMPOSE_PROJECT/turn" ]] || fail 'TURN container identity changed'
elif [[ -f $target/.applied ]]; then
  fail 'previously active TURN container is missing; leaving current certificate unchanged'
fi

# The marker belongs to one exact container, not just a certificate digest.
# Inspect even on unchanged renewals so missing/unhealthy services cannot pass
# a dry-run hook. A replacement container is validated through restart below.
if [[ -n $container && $old == "versions/$version" && -f $target/.applied && $(cat "$target/.applied") == "$version $container" ]]; then
  status=$(docker inspect --format '{{.State.Running}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container") || fail 'could not inspect TURN health'
  [[ $status == true/healthy ]] || fail 'unchanged certificate belongs to an unhealthy TURN container'
  log 'certificate unchanged; same TURN container is healthy; no restart needed'
  exit 0
fi

switch_current() {
  ln -s "$1" "$target/.current.next"
  mv -Tf -- "$target/.current.next" "$target/current"
}
switch_current "versions/$version"
if [[ -z $container ]]; then
  log 'certificate staged; deploy the TURN resource, then run this hook once again'
  exit 0
fi

# Restart is deliberate: it is the verified lifecycle supported by this package.
# A failed restart/health check rolls the certificate pointer back. Never restart
# the Coolify proxy or other containers. Renewal can briefly interrupt calls.
healthy() {
  for ((attempt=0; attempt<45; attempt++)); do
    status=$(docker inspect --format '{{.State.Running}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container") || return 1
    [[ $status != false/* ]] || return 1
    [[ $status == true/healthy ]] && return 0
    sleep 2
  done
  return 1
}
if ! docker restart --time 30 "$container" >/dev/null || ! healthy; then
  if [[ -n $old ]]; then
    switch_current "$old"
    docker restart --time 30 "$container" >/dev/null || log 'rollback restart failed; operator action required'
  fi
  fail 'TURN did not become healthy after certificate deployment; prior pointer restored when available'
fi
printf '%s %s\n' "$version" "$container" > "$target/.applied.next"
mv -Tf -- "$target/.applied.next" "$target/.applied"
log 'certificate deployed; TURN is healthy'
