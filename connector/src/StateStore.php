<?php

declare(strict_types=1);

namespace ReplyFlow;

use RuntimeException;

final class StateStore
{
    public static function path(string $name): string
    {
        $root = rtrim(getenv('SESSION_PATH') ?: dirname(__DIR__).'/storage', '/');
        if (!is_dir($root) && !mkdir($root, 0700, true) && !is_dir($root)) {
            throw new RuntimeException('Unable to create session storage.');
        }
        return $root.'/'.$name;
    }

    public static function sessionPath(): string
    {
        return self::path('owner.madeline');
    }

    /** True once a Telegram session directory exists on the persistent disk. */
    public static function sessionExists(): bool
    {
        return file_exists(self::sessionPath());
    }

    /**
     * Records that the always-on process is alive. Deliberately plain text and
     * free of session material so the self-check page can read it cheaply.
     */
    public static function heartbeat(): void
    {
        @file_put_contents(self::path('worker.heartbeat'), (string) time(), LOCK_EX);
    }

    public static function heartbeatAge(): ?int
    {
        $raw = @file_get_contents(self::path('worker.heartbeat'));
        if ($raw === false || !ctype_digit(trim($raw))) {
            return null;
        }

        return max(0, time() - (int) trim($raw));
    }

    public static function read(): array
    {
        $file = self::path('state.sealed');
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

    public static function write(array $state): void
    {
        $plain = json_encode($state, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $cipher = sodium_crypto_secretbox($plain, $nonce, self::key());
        $value = sodium_bin2base64($nonce, SODIUM_BASE64_VARIANT_URLSAFE_NO_PADDING).'.'.sodium_bin2base64($cipher, SODIUM_BASE64_VARIANT_URLSAFE_NO_PADDING);
        file_put_contents(self::path('state.sealed'), $value, LOCK_EX);
        chmod(self::path('state.sealed'), 0600);
    }

    public static function clear(): void
    {
        foreach (glob(self::sessionPath().'*') ?: [] as $file) {
            is_dir($file) ? self::removeDirectory($file) : @unlink($file);
        }
        @unlink(self::path('state.sealed'));
        foreach (glob(self::path('action_*')) ?: [] as $file) {
            @unlink($file);
        }
        @unlink(self::path('worker.heartbeat'));
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
