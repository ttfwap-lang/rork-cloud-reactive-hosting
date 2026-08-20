<?php

declare(strict_types=1);

namespace ReplyFlow;

use Throwable;

/**
 * Plain-language readiness report for the deployed connector.
 *
 * Reports only presence, shape and freshness — never the value of a secret,
 * a phone number, a session token or any message content.
 */
final class SelfCheck
{
    public static function report(): array
    {
        $checks = [
            self::phpVersion(),
            self::extensions(),
            self::sessionKey(),
            self::sharedSecret(),
            self::controlPlane(),
            self::telegramCredentials(),
            self::storage(),
            self::worker(),
            self::session(),
        ];
        $failing = array_values(array_filter($checks, static fn (array $check): bool => $check['status'] === 'fail'));
        $warning = array_values(array_filter($checks, static fn (array $check): bool => $check['status'] === 'warn'));

        return [
            'ok' => count($failing) === 0,
            'summary' => count($failing) > 0
                ? count($failing).' setting(s) still need attention before Telegram can connect.'
                : (count($warning) > 0
                    ? 'Configuration is valid. '.count($warning).' item(s) are waiting on you.'
                    : 'Everything is configured and the always-on process is running.'),
            'checks' => $checks,
        ];
    }

    private static function result(string $name, string $status, string $detail): array
    {
        return ['name' => $name, 'status' => $status, 'detail' => $detail];
    }

    private static function phpVersion(): array
    {
        return version_compare(PHP_VERSION, '8.3.0', '>=')
            ? self::result('PHP version', 'pass', 'Running PHP '.PHP_MAJOR_VERSION.'.'.PHP_MINOR_VERSION.'.')
            : self::result('PHP version', 'fail', 'PHP 8.3 or newer is required.');
    }

    private static function extensions(): array
    {
        $required = ['sodium', 'curl', 'json', 'mbstring', 'openssl', 'gmp', 'pcntl'];
        $missing = array_values(array_filter($required, static fn (string $name): bool => !extension_loaded($name)));

        return count($missing) === 0
            ? self::result('PHP extensions', 'pass', 'All required extensions are installed.')
            : self::result('PHP extensions', 'fail', 'Missing: '.implode(', ', $missing).'.');
    }

    private static function sessionKey(): array
    {
        $value = (string) (getenv('SESSION_ENCRYPTION_KEY') ?: '');
        if ($value === '') {
            return self::result('SESSION_ENCRYPTION_KEY', 'fail', 'Not set. Add it as a service variable.');
        }

        return strlen($value) >= 32
            ? self::result('SESSION_ENCRYPTION_KEY', 'pass', 'Set and long enough.')
            : self::result('SESSION_ENCRYPTION_KEY', 'fail', 'Too short — it needs at least 32 characters.');
    }

    private static function sharedSecret(): array
    {
        $value = (string) (getenv('CONNECTOR_SHARED_SECRET') ?: '');
        if ($value === '') {
            return self::result('CONNECTOR_SHARED_SECRET', 'fail', 'Not set. It must match the value in the ReplyFlow engine.');
        }

        return strlen($value) >= 24
            ? self::result('CONNECTOR_SHARED_SECRET', 'pass', 'Set and long enough.')
            : self::result('CONNECTOR_SHARED_SECRET', 'fail', 'Too short — it needs at least 24 characters.');
    }

    private static function controlPlane(): array
    {
        $value = trim((string) (getenv('CONTROL_PLANE_URL') ?: ''));
        if ($value === '') {
            return self::result('CONTROL_PLANE_URL', 'fail', 'Not set. Paste your ReplyFlow engine address here.');
        }
        if (!str_starts_with($value, 'https://')) {
            return self::result('CONTROL_PLANE_URL', 'fail', 'Must start with https://.');
        }
        if (str_ends_with($value, '/')) {
            return self::result('CONTROL_PLANE_URL', 'warn', 'Remove the trailing slash to avoid double slashes.');
        }

        return self::result('CONTROL_PLANE_URL', 'pass', 'Points at an https address.');
    }

    private static function telegramCredentials(): array
    {
        $apiId = trim((string) (getenv('TELEGRAM_API_ID') ?: ''));
        $apiHash = trim((string) (getenv('TELEGRAM_API_HASH') ?: ''));
        if ($apiId === '' && $apiHash === '') {
            return self::result('Telegram app credentials', 'fail', 'TELEGRAM_API_ID and TELEGRAM_API_HASH are not set. Get them from my.telegram.org.');
        }
        if (preg_match('/^\d{4,12}$/', $apiId) !== 1) {
            return self::result('Telegram app credentials', 'fail', 'TELEGRAM_API_ID should be digits only.');
        }
        if (preg_match('/^[a-fA-F0-9]{32}$/', $apiHash) !== 1) {
            return self::result('Telegram app credentials', 'fail', 'TELEGRAM_API_HASH should be exactly 32 hex characters.');
        }

        return self::result('Telegram app credentials', 'pass', 'Both values are present and correctly shaped.');
    }

    private static function storage(): array
    {
        try {
            $probe = StateStore::path('.writable');
        } catch (Throwable) {
            return self::result('Persistent disk', 'fail', 'The storage folder could not be created. Attach a volume mounted at /data.');
        }
        if (@file_put_contents($probe, '1') === false) {
            return self::result('Persistent disk', 'fail', 'The storage folder is not writable. Check the volume mount at /data.');
        }
        @unlink($probe);

        return self::result('Persistent disk', 'pass', 'Storage folder exists and is writable.');
    }

    private static function worker(): array
    {
        $age = StateStore::heartbeatAge();
        if ($age === null) {
            return self::result('Always-on process', 'fail', 'No heartbeat yet. The background process has not started.');
        }

        return $age <= 60
            ? self::result('Always-on process', 'pass', "Alive — last heartbeat {$age}s ago.")
            : self::result('Always-on process', 'fail', "Stalled — last heartbeat {$age}s ago.");
    }

    private static function session(): array
    {
        if (!StateStore::sessionExists()) {
            return self::result('Telegram login', 'warn', 'Not logged in yet. Start a QR login from the ReplyFlow console.');
        }
        try {
            $status = (string) (StateStore::read()['status'] ?? 'offline');
        } catch (Throwable) {
            return self::result('Telegram login', 'fail', 'Saved state could not be decrypted — SESSION_ENCRYPTION_KEY likely changed.');
        }

        return $status === 'online'
            ? self::result('Telegram login', 'pass', 'A personal session is saved and online.')
            : self::result('Telegram login', 'warn', "A session exists but is currently {$status}.");
    }
}
