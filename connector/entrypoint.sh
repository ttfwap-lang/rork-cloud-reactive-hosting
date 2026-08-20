#!/usr/bin/env sh
set -eu
umask 077

DATA_DIR="${SESSION_PATH:-/data}"

# Railway mounts volumes as root. Fix ownership once, then drop privileges so
# the Telegram session is never written or read by a root-owned process.
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R www-data:www-data "$DATA_DIR"
  exec gosu www-data "$0" "$@"
fi

# The always-on session owner.
php /app/worker.php &
worker_pid=$!
trap 'kill "$worker_pid" 2>/dev/null || true' TERM INT EXIT

# PHP_CLI_SERVER_WORKERS forks the built-in server so a long login or send can
# never block the health check, which would otherwise restart the service mid-login.
PHP_CLI_SERVER_WORKERS="${PHP_CLI_SERVER_WORKERS:-8}" \
  php -S "0.0.0.0:${PORT:-8080}" -t /app/public /app/public/index.php
