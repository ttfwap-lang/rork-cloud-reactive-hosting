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

    public static function post(array $payload): void
    {
        $controlPlane = rtrim(getenv('CONTROL_PLANE_URL') ?: '', '/');
        if ($controlPlane === '') {
            return;
        }
        try {
            $body = json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
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
            CURLOPT_HTTPHEADER => Signature::outboundHeaders(self::PATH, $body),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_CONNECTTIMEOUT => 5,
        ]);
        curl_exec($curl);
        curl_close($curl);
    }

    /** Announces a session-level state change (never carries message content). */
    public static function status(string $status, string $detail, ?string $identity = null): void
    {
        $payload = ['type' => 'status', 'status' => $status, 'detail' => $detail];
        if ($identity !== null) {
            $payload['identity'] = $identity;
        }
        self::post($payload);
    }
}
