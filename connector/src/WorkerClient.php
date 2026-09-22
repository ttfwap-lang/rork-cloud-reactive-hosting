<?php

declare(strict_types=1);

namespace ReplyFlow;

use Throwable;

/**
 * Async signed client for communicating with the Worker control plane.
 * Unlike EventForwarder, this client reads and returns the response.
 */
final class WorkerClient
{
    /**
     * Sends a signed POST request to the control plane and returns the decoded response.
     *
     * @return array{status: int, data: mixed}
     * @throws ConnectorException on failure or non-2xx response
     */
    public static function post(string $path, array $payload, ?string $tenant = null, float $timeout = 10.0): array
    {
        $controlPlane = rtrim(getenv('CONTROL_PLANE_URL') ?: '', '/');
        if ($controlPlane === '') {
            throw new ConnectorException('CONTROL_PLANE_URL is not configured.', null, 500);
        }

        $resolved = StateStore::normalize($tenant ?? StateStore::tenant());
        try {
            $body = json_encode($payload + ['tenant' => $resolved], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        } catch (Throwable $e) {
            throw new ConnectorException('Failed to encode worker request payload: '.$e->getMessage(), null, 400, $e);
        }

        $url = $controlPlane.$path;
        $headers = Signature::outboundHeaders($path, $body, $resolved);

        try {
            $response = AsyncHttpClient::request('POST', $url, $headers, $body, $timeout);
        } catch (Throwable $e) {
            throw new ConnectorException('Worker request failed: '.$e->getMessage(), null, 502, $e);
        }

        $status = $response['status'];
        $rawBody = $response['body'];
        $decoded = null;
        if ($rawBody !== '') {
            try {
                $decoded = json_decode($rawBody, true, flags: JSON_THROW_ON_ERROR);
            } catch (Throwable) {
                $decoded = ['raw' => $rawBody];
            }
        }

        if ($status < 200 || $status >= 300) {
            $errorMsg = is_array($decoded) && isset($decoded['error']) ? (string) $decoded['error'] : 'Worker returned status '.$status;
            throw new ConnectorException($errorMsg, null, $status);
        }

        return [
            'status' => $status,
            'data' => $decoded,
        ];
    }
}
