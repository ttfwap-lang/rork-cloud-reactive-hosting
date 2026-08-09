FROM php:8.4-cli-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends git unzip libgmp-dev libicu-dev libpng-dev libxml2-dev libzip-dev \
    && docker-php-ext-install gmp intl pcntl sockets zip \
    && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /app
COPY composer.json composer.lock* ./
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress --optimize-autoloader
COPY . .
RUN chmod +x /app/entrypoint.sh && mkdir -p /data && chown -R www-data:www-data /data /app
USER www-data
ENV SESSION_PATH=/data PORT=8080
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD php -r '$r=@file_get_contents("http://127.0.0.1:".(getenv("PORT")?:8080)."/health"); exit($r===false?1:0);'
ENTRYPOINT ["/app/entrypoint.sh"]
