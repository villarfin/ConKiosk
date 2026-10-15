#!/bin/sh
set -eu

# Configure CONKIOSK_BACKUP_DATABASE and CONKIOSK_BACKUP_USER in a protected
# systemd EnvironmentFile before enabling the timer.
: "${CONKIOSK_BACKUP_DATABASE:?Set CONKIOSK_BACKUP_DATABASE}"
: "${CONKIOSK_BACKUP_USER:?Set CONKIOSK_BACKUP_USER}"
backup_dir=${CONKIOSK_BACKUP_DIR:-/var/lib/conkiosk/backups}
umask 077
mkdir -p "$backup_dir"
exec 9>"$backup_dir/.backup.lock"
flock -n 9 || exit 0
pending=$(mktemp "$backup_dir/.pending.XXXXXX")
trap 'rm -f -- "$pending"' EXIT HUP INT TERM
PGUSER="$CONKIOSK_BACKUP_USER" pg_dump -Fc "$CONKIOSK_BACKUP_DATABASE" > "$pending"
pg_restore --list "$pending" >/dev/null
destination="$backup_dir/conkiosk-$(date +%F-%H%M%S).dump"
mv -- "$pending" "$destination"
if [ -n "${CONKIOSK_BACKUP_MIRROR:-}" ]; then
    mountpoint -q "$CONKIOSK_BACKUP_MIRROR" || { echo 'Backup mirror is not mounted' >&2; exit 1; }
    cp -- "$destination" "$CONKIOSK_BACKUP_MIRROR/"
fi
find "$backup_dir" -type f -name 'conkiosk-*.dump' -mtime +14 -delete
