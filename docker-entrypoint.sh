#!/bin/sh
set -e
# Salin berkas bawaan ke volume data bila belum ada, lalu seed (idempoten) sebelum server dijalankan.
for f in master_data_seed.json Template_SE.xlsx; do
  [ -f "/app/data/$f" ] || cp "/app/seed/$f" "/app/data/$f"
done
if [ "${SEED_ON_START:-1}" = "1" ]; then node src/db/seed.js; fi
exec "$@"
