#!/bin/sh
set -eu

# Configure CONKIOSK_BACKUP_DATABASE and CONKIOSK_BACKUP_USER in a protected
# systemd EnvironmentFile before enabling the timer.
: "${CONKIOSK_BACKUP_DATABASE:?Set CONKIOSK_BACKUP_DATABASE}"
: "${CONKIOSK_BACKUP_USER:?Set CONKIOSK_BACKUP_USER}"
backup_dir=/var/lib/conkiosk/backups
mkdir -p "$backup_dir"
umask 077
PGUSER="$CONKIOSK_BACKUP_USER" pg_dump -Fc "$CONKIOSK_BACKUP_DATABASE" > "$backup_dir/conkiosk-$(date +%F).dump"
find "$backup_dir" -type f -name 'conkiosk-*.dump' -mtime +14 -delete
