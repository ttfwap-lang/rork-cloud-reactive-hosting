<?php

declare(strict_types=1);

namespace ReplyFlow;

use Throwable;
use function Amp\async;

/**
 * Signed, fire-and-forget delivery of connector events to the control plane.
 *
 * Payloads are never written to disk or to the log: message bodies are treated
 * as sensitive and only ever exist in memory for the duration of one request.
 */
final class EventForwarder
{
    private const PATH = '/connector/event';

    /** @var (callable(array, ?string): void)|null */
    private static $interceptor = null;

    public static function setInterceptor(?callable $interceptor): void
    {
        self::$interceptor = $interceptor;
    }

    /**
     * Delivers to the engine belonging to one account. The tenant defaults to the
     * one this process was started for, so a child can only ever report as itself.
     */
    public static function post(array $payload, ?string $tenant = null): void
    {
        if (self::$interceptor !== null) {
            (self::$interceptor)($payload, $tenant);
        }
        $controlPlane = rtrim(getenv('CONTROL_PLANE_URL') ?: '', '/');
        if ($controlPlane === '') {
            return;
        }
        $resolved = StateStore::normalize($tenant ?? StateStore::tenant());
        try {
            $body = json_encode($payload + ['tenant' => $resolved], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        } catch (Throwable) {
            return;
        }

        $headers = Signature::outboundHeaders(self::PATH, $body, $resolved);
        $url = $controlPlane.self::PATH;

        try {
            async(static function () use ($url, $headers, $body): void {
                try {
                    AsyncHttpClient::request('POST', $url, $headers, $body, 10.0);
                } catch (Throwable) {
                    // Fire-and-forget: discard failures silently
                }
            });
        } catch (Throwable) {
            // Silently absorb any fiber scheduling failure
        }
    }

    /** Announces a session-level state change (never carries message content). */
    public static function status(string $status, string $detail, ?string $identity = null, ?string $tenant = null): void
    {
        $payload = ['type' => 'status', 'status' => $status, 'detail' => $detail];
        if ($identity !== null) {
            $payload['identity'] = $identity;
        }
        self::post($payload, $tenant);
    }
}
