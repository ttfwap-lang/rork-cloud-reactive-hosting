<?php

declare(strict_types=1);

namespace ReplyFlow\Agent;

use ReplyFlow\StateStore;
use RuntimeException;
use Throwable;

/**
 * Append-only encrypted log I/O for agent events.
 *
 * Log format: one sealed event per line:
 *   base64url(nonce).base64url(cipher)\n
 * Sealed per event so events can be appended incrementally without rewriting.
 *
 * Durability requirement: fflush after every tool.intent event to survive child process death.
 */
final class AgentLog
{
    /** Valid event kinds defined by the specification */
    public const VALID_KINDS = [
        'instruction',
        'observation',
        'turn.start',
        'turn.attempt',
        'tool.intent',
        'tool.result',
        'lease.acquired',
        'lease.released',
        'turn.end',
        'turn.abandoned',
    ];

    /**
     * Appends an event to the tenant's agent log for a specific chat or key.
     *
     * @param array{kind: string, ...} $event
     */
    public static function append(string $logName, array $event, ?string $tenant = null): void
    {
        $file = self::logPath($logName, $tenant);
        $encodedLine = self::sealEvent($event);

        $handle = fopen($file, 'ab');
        if ($handle === false) {
            throw new RuntimeException("Failed to open agent log file: {$file}");
        }

        try {
            fwrite($handle, $encodedLine."\n");
            // Flushes intent events immediately to guarantee write-ahead durability before Telegram action
            if (($event['kind'] ?? '') === 'tool.intent') {
                fflush($handle);
            }
        } finally {
            fclose($handle);
        }
    }

    /**
     * Reads and decrypts all events from the log in chronological order.
     *
     * @return list<array>
     */
    public static function readAll(string $logName, ?string $tenant = null): array
    {
        $file = self::logPath($logName, $tenant);
        if (!is_file($file)) {
            return [];
        }

        $handle = fopen($file, 'rb');
        if ($handle === false) {
            return [];
        }

        $events = [];
        $key = self::key();

        try {
            while (($line = fgets($handle)) !== false) {
                $trimmed = trim($line);
                if ($trimmed === '' || !str_contains($trimmed, '.')) {
                    continue;
                }

                [$nonceEncoded, $cipherEncoded] = explode('.', $trimmed, 2);
                try {
                    $nonce = sodium_base642bin($nonceEncoded, SODIUM_BASE64_VARIANT_URLSAFE_NO_PADDING);
                    $cipher = sodium_base642bin($cipherEncoded, SODIUM_BASE64_VARIANT_URLSAFE_NO_PADDING);
                    $plain = sodium_crypto_secretbox_open($cipher, $nonce, $key);
                    if ($plain === false) {
                        continue;
                    }

                    $decoded = json_decode($plain, true, flags: JSON_THROW_ON_ERROR);
                    if (is_array($decoded)) {
                        $events[] = $decoded;
                    }
                } catch (Throwable) {
                    // Skip corrupted or unreadable lines
                    continue;
                }
            }
        } finally {
            fclose($handle);
        }

        return $events;
    }

    /**
     * Derives the full path to an agent log file inside the tenant folder.
     */
    public static function logPath(string $logName, ?string $tenant = null): string
    {
        $safeName = preg_replace('/[^a-zA-Z0-9_-]/', '_', $logName);

        return StateStore::path("agent-{$safeName}.log", $tenant);
    }

    /**
     * Encrypts a single event into the line format: base64url(nonce).base64url(cipher).
     */
    public static function sealEvent(array $event): string
    {
        $plain = json_encode($event, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $cipher = sodium_crypto_secretbox($plain, $nonce, self::key());

        return sodium_bin2base64($nonce, SODIUM_BASE64_VARIANT_URLSAFE_NO_PADDING)
            .'.'
            .sodium_bin2base64($cipher, SODIUM_BASE64_VARIANT_URLSAFE_NO_PADDING);
    }

    private static function key(): string
    {
        $secret = getenv('SESSION_ENCRYPTION_KEY') ?: '';
        if (strlen($secret) < 32) {
            throw new RuntimeException('SESSION_ENCRYPTION_KEY must contain at least 32 characters.');
        }

        return sodium_crypto_generichash($secret, '', SODIUM_CRYPTO_SECRETBOX_KEYBYTES);
    }
}
