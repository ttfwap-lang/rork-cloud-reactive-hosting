<?php

declare(strict_types=1);

namespace ReplyFlow;

use RuntimeException;

/**
 * Per-account storage on the persistent disk.
 *
 * Every account is a tenant with its own folder: its own encrypted session, its
 * own sealed state and its own action receipts. Nothing is shared between them,
 * so one account can never see, resume or delete another account's Telegram.
 */
final class StateStore
{
    /** The original single-account install, kept so its session survives the change. */
    public const OWNER_TENANT = 'primary';

    private static string $tenant = self::OWNER_TENANT;

    /** Selects the account this process (or this request) is acting for. */
    public static function use(string $tenant): void
    {
        self::$tenant = self::normalize($tenant);
    }

    public static function tenant(): string
    {
        return self::$tenant;
    }

    /** Tenant handles come from the control plane and are never free-form input. */
    public static function normalize(string $tenant): string
    {
        $clean = trim($tenant);

        return preg_match('/^(primary|t-[0-9a-f]{16})$/', $clean) === 1 ? $clean : self::OWNER_TENANT;
    }

    /** The shared volume root: holds the tenant folders and the supervisor heartbeat. */
    public static function root(): string
    {
        $root = rtrim(getenv('SESSION_PATH') ?: dirname(__DIR__).'/storage', '/');
        if (!is_dir($root) && !mkdir($root, 0700, true) && !is_dir($root)) {
            throw new RuntimeException('Unable to create session storage.');
        }

        return $root;
    }

    public static function path(string $name, ?string $tenant = null): string
    {
        $directory = self::root().'/tenants/'.($tenant === null ? self::$tenant : self::normalize($tenant));
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new RuntimeException('Unable to create session storage.');
        }

        return $directory.'/'.$name;
    }

    public static function sessionPath(?string $tenant = null): string
    {
        $resolved = $tenant === null ? self::$tenant : self::normalize($tenant);
        // The first install kept its session at the volume root. It is still valid,
        // so it is adopted in place rather than forcing a fresh Telegram login.
        if ($resolved === self::OWNER_TENANT) {
            $legacy = self::root().'/owner.madeline';
            if (file_exists($legacy) && !file_exists(self::path('session.madeline', $resolved))) {
                return $legacy;
            }
        }

        return self::path('session.madeline', $resolved);
    }

    /** True once a Telegram session directory exists on the persistent disk. */
    public static function sessionExists(?string $tenant = null): bool
    {
        return file_exists(self::sessionPath($tenant));
    }

    /** Every account folder that has ever been written to. */
    public static function tenants(): array
    {
        $base = self::root().'/tenants';
        if (!is_dir($base)) {
            return [];
        }
        $found = [];
        foreach (array_diff(scandir($base) ?: [], ['.', '..']) as $entry) {
            if (is_dir($base.'/'.$entry) && preg_match('/^(primary|t-[0-9a-f]{16})$/', $entry) === 1) {
                $found[] = $entry;
            }
        }
        sort($found);

        return $found;
    }

    /**
     * Records that a process is alive. Deliberately plain text and free of session
     * material so the health route and self-check page can read it cheaply.
     */
    public static function heartbeat(?string $tenant = null): void
    {
        @file_put_contents(self::path('worker.heartbeat', $tenant), (string) time(), LOCK_EX);
    }

    /** The supervisor's own pulse, independent of whether any account is connected. */
    public static function supervisorHeartbeat(): void
    {
        @file_put_contents(self::root().'/supervisor.heartbeat', (string) time(), LOCK_EX);
    }

    public static function heartbeatAge(?string $tenant = null): ?int
    {
        return self::ageOf(self::path('worker.heartbeat', $tenant));
    }

    public static function supervisorAge(): ?int
    {
        return self::ageOf(self::root().'/supervisor.heartbeat');
    }

    private static function ageOf(string $file): ?int
    {
        $raw = @file_get_contents($file);
        if ($raw === false || !ctype_digit(trim($raw))) {
            return null;
        }

        return max(0, time() - (int) trim($raw));
    }

    public static function read(?string $tenant = null): array
    {
        $file = self::path('state.sealed', $tenant);
        if (!is_file($file)) {
            return ['status' => 'offline', 'identity' => null, 'phoneMasked' => null, 'disabled' => false];
        }
        $raw = file_get_contents($file);
        if ($raw === false || !str_contains($raw, '.')) {
            throw new RuntimeException('Stored connector state is invalid.');
        }
        [$nonceEncoded, $cipherEncoded] = explode('.', $raw, 2);
        $plain = sodium_crypto_secretbox_open(
            sodium_base642bin($cipherEncoded, SODIUM_BASE64_VARIANT_URLSAFE_NO_PADDING),
            sodium_base642bin($nonceEncoded, SODIUM_BASE64_VARIANT_URLSAFE_NO_PADDING),
            self::key(),
        );
        if ($plain === false) {
            throw new RuntimeException('Stored connector state could not be decrypted.');
        }

        return json_decode($plain, true, flags: JSON_THROW_ON_ERROR);
    }

    public static function write(array $state, ?string $tenant = null): void
    {
        $plain = json_encode($state, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $cipher = sodium_crypto_secretbox($plain, $nonce, self::key());
        $value = sodium_bin2base64($nonce, SODIUM_BASE64_VARIANT_URLSAFE_NO_PADDING).'.'.sodium_bin2base64($cipher, SODIUM_BASE64_VARIANT_URLSAFE_NO_PADDING);
        $file = self::path('state.sealed', $tenant);
        file_put_contents($file, $value, LOCK_EX);
        chmod($file, 0600);
    }

    /** Erases one account's Telegram material without touching anybody else's. */
    public static function clear(?string $tenant = null): void
    {
        foreach (glob(self::sessionPath($tenant).'*') ?: [] as $file) {
            is_dir($file) ? self::removeDirectory($file) : @unlink($file);
        }
        @unlink(self::path('state.sealed', $tenant));
        foreach (glob(self::path('action_*', $tenant)) ?: [] as $file) {
            @unlink($file);
        }
        @unlink(self::path('worker.heartbeat', $tenant));
    }

    private static function key(): string
    {
        $secret = getenv('SESSION_ENCRYPTION_KEY') ?: '';
        if (strlen($secret) < 32) {
            throw new RuntimeException('SESSION_ENCRYPTION_KEY must contain at least 32 characters.');
        }

        return sodium_crypto_generichash($secret, '', SODIUM_CRYPTO_SECRETBOX_KEYBYTES);
    }

    private static function removeDirectory(string $directory): void
    {
        foreach (array_diff(scandir($directory) ?: [], ['.', '..']) as $item) {
            $path = $directory.'/'.$item;
            is_dir($path) ? self::removeDirectory($path) : @unlink($path);
        }
        @rmdir($directory);
    }
}
