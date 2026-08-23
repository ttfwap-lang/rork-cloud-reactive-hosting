# Pinned base images so every deploy resolves to the same toolchain.
FROM composer:2.8.4 AS composer
FROM php:8.4.2-cli-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git unzip gosu libgmp-dev libicu-dev libpng-dev libxml2-dev libzip-dev \
    && docker-php-ext-install gmp intl pcntl sockets zip \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer /usr/bin/composer /usr/bin/composer
WORKDIR /app

# Install dependencies from the lock file when present so builds are byte-identical.
COPY composer.json composer.lock* ./
RUN if [ -f composer.lock ]; then \
        composer install --no-dev --prefer-dist --no-interaction --no-progress --optimize-autoloader; \
    else \
        composer update --no-dev --prefer-dist --no-interaction --no-progress --optimize-autoloader; \
    fi

COPY . .
RUN chmod +x /app/entrypoint.sh \
    && mkdir -p /data \
    && chown -R www-data:www-data /data /app

ENV SESSION_PATH=/data PORT=8080
EXPOSE 8080

# No VOLUME directive: the platform rejects it and supplies its own persistent
# disk mounted at /data, which is what actually keeps a Telegram login alive.

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
    CMD php -r '$r=@file_get_contents("http://127.0.0.1:".(getenv("PORT")?:8080)."/health"); exit($r===false?1:0);'

ENTRYPOINT ["/app/entrypoint.sh"]
