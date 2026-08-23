<?php

declare(strict_types=1);

namespace ReplyFlow;

use Throwable;

/**
 * Signed, fire-and-forget delivery of connector events to the control plane.
 *
 * Payloads are never written to disk or to the log: message bodies are treated
 * as sensitive and only ever exist in memory for the duration of one request.
 */
final class EventForwarder
{
    private const PATH = '/connector/event';

    /**
     * Delivers to the engine belonging to one account. The tenant defaults to the
     * one this process was started for, so a child can only ever report as itself.
     */
    public static function post(array $payload, ?string $tenant = null): void
    {
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
        $curl = curl_init($controlPlane.self::PATH);
        if ($curl === false) {
            return;
        }
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => Signature::outboundHeaders(self::PATH, $body, $resolved),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_CONNECTTIMEOUT => 5,
        ]);
        curl_exec($curl);
        curl_close($curl);
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
