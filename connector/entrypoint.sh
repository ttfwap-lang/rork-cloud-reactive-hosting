#!/usr/bin/env sh
set -eu
umask 077
php /app/worker.php &
worker_pid=$!
trap 'kill "$worker_pid" 2>/dev/null || true' TERM INT EXIT
php -S "0.0.0.0:${PORT:-8080}" -t /app/public /app/public/index.php
