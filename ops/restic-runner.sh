#!/bin/sh
set -eu
# Existing --profile offsite deployments omit OFFSITE_ENABLED and remain enabled.
# Coolify runs this service continuously and explicitly opts in through the flag.
case "${OFFSITE_ENABLED:-true}" in
  false)
    echo 'Offsite backup is disabled. Set OFFSITE_ENABLED=true to enable it.'
    trap 'exit 0' INT TERM
    while true; do sleep 60 & wait $!; done
    ;;
  true) ;;
  *) echo 'OFFSITE_ENABLED must be true or false.' >&2; exit 1;;
esac
: "${RESTIC_REPOSITORY:?Set RESTIC_REPOSITORY for offsite backups}"
if [ -n "${RESTIC_PASSWORD_FILE:-}" ]; then
  test -r "$RESTIC_PASSWORD_FILE" && test -s "$RESTIC_PASSWORD_FILE" || {
    echo 'The repository password file must be readable and non-empty.' >&2; exit 1;
  }
else
  : "${RESTIC_PASSWORD:?Set RESTIC_PASSWORD or mount RESTIC_PASSWORD_FILE}"
fi
interval="${RESTIC_INTERVAL_SECONDS:-86400}"
case "$interval" in ''|*[!0-9]*) echo 'Invalid RESTIC_INTERVAL_SECONDS' >&2; exit 1;; esac
[ "$interval" -ge 60 ] || exit 1
while true; do
  if restic snapshots >/dev/null 2>&1 || restic init; then
    if restic backup --host mola --tag mola --exclude '/backups/.partial-*' --exclude '/backups/.backup-lock' /backups &&
       restic forget --host mola --tag mola --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune &&
       restic check; then
      date +%s > /status/restic-success
      echo 'Encrypted offsite backup and repository check completed.'
    else
      echo 'Offsite backup failed; success timestamp was not advanced.' >&2
    fi
  fi
  sleep "$interval" & wait $!
done
