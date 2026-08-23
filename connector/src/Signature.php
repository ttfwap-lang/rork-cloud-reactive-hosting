<?php

declare(strict_types=1);

namespace ReplyFlow;

final class Signature
{
    public static function verify(string $method, string $path, string $body): bool
    {
        $secret = getenv('CONNECTOR_SHARED_SECRET') ?: '';
        $timestamp = $_SERVER['HTTP_X_REPLYFLOW_TIMESTAMP'] ?? '';
        $nonce = $_SERVER['HTTP_X_REPLYFLOW_NONCE'] ?? '';
        $provided = $_SERVER['HTTP_X_REPLYFLOW_SIGNATURE'] ?? '';
        if (strlen($secret) < 24 || !ctype_digit($timestamp) || $nonce === '' || $provided === '') {
            return false;
        }
        if (abs((int) round(microtime(true) * 1000) - (int) $timestamp) > 60000) {
            return false;
        }
        // Replay protection is global, not per account: a nonce is spent once for
        // the whole connector, whichever tenant the request claims to be for.
        $nonceFile = self::noncePath(hash('sha256', $nonce));
        if (is_file($nonceFile)) {
            return false;
        }
        $expected = hash_hmac('sha256', $method."\n".$path."\n".$timestamp."\n".$nonce."\n".$body, $secret);
        if (!hash_equals($expected, $provided)) {
            return false;
        }
        file_put_contents($nonceFile, (string) time(), LOCK_EX);
        foreach (glob(self::noncePath('*')) ?: [] as $file) {
            if (filemtime($file) !== false && filemtime($file) < time() - 120) {
                @unlink($file);
            }
        }
        return true;
    }

    public static function outboundHeaders(string $path, string $body, ?string $tenant = null): array
    {
        $secret = getenv('CONNECTOR_SHARED_SECRET') ?: '';
        $timestamp = (string) round(microtime(true) * 1000);
        $nonce = bin2hex(random_bytes(16));
        $signature = hash_hmac('sha256', "POST\n{$path}\n{$timestamp}\n{$nonce}\n{$body}", $secret);

        return [
            'Content-Type: application/json',
            'X-ReplyFlow-Timestamp: '.$timestamp,
            'X-ReplyFlow-Nonce: '.$nonce,
            'X-ReplyFlow-Signature: '.$signature,
            // Tells the control plane which account's engine this event belongs to.
            'X-ReplyFlow-Tenant: '.StateStore::normalize($tenant ?? StateStore::tenant()),
        ];
    }

    private static function noncePath(string $name): string
    {
        $directory = StateStore::root().'/nonces';
        if (!is_dir($directory)) {
            @mkdir($directory, 0700, true);
        }

        return $directory.'/nonce_'.$name;
    }
}
