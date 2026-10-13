#!/bin/sh
# Runs inside the backup container: a backup now, then one every BACKUP_INTERVAL_SECONDS.
# Keeps KEEP_DAYS days. These files are the business: also copy them off this server.
set -eu
mkdir -p /backups

while true; do
  ts=$(date +%Y%m%d-%H%M)
  if pg_dump -Fc -f "/backups/ledger-$ts.dump.part" && mv "/backups/ledger-$ts.dump.part" "/backups/ledger-$ts.dump"; then
    echo "backup: database -> ledger-$ts.dump"
  else
    echo "backup: database dump FAILED" >&2
    rm -f "/backups/ledger-$ts.dump.part"
  fi
  if tar -czf "/backups/storage-$ts.tar.gz.part" -C /data storage && mv "/backups/storage-$ts.tar.gz.part" "/backups/storage-$ts.tar.gz"; then
    echo "backup: receipts -> storage-$ts.tar.gz"
  else
    echo "backup: receipts archive FAILED" >&2
    rm -f "/backups/storage-$ts.tar.gz.part"
  fi
  find /backups -name 'ledger-*.dump' -mtime +"$KEEP_DAYS" -delete
  find /backups -name 'storage-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
  sleep "$BACKUP_INTERVAL_SECONDS"
done
