<?php

declare(strict_types=1);

namespace ReplyFlow;

use Amp\Http\Client\HttpClient;
use Amp\Http\Client\HttpClientBuilder;
use Amp\Http\Client\Request;
use Amp\TimeoutCancellation;

/**
 * Async HTTP transport wrapper over amphp/http-client (Amp v3).
 */
final class AsyncHttpClient
{
    private static ?HttpClient $client = null;

    public static function getClient(): HttpClient
    {
        if (self::$client === null) {
            self::$client = HttpClientBuilder::buildDefault();
        }

        return self::$client;
    }

    /**
     * Executes an async HTTP request.
     *
     * @param array<string, string>|list<string> $headers
     * @return array{status: int, body: string, headers: array<string, list<string>>}
     */
    public static function request(
        string $method,
        string $url,
        array $headers = [],
        ?string $body = null,
        float $timeout = 10.0,
    ): array {
        $request = new Request($url, strtoupper($method));
        if ($body !== null && $body !== '') {
            $request->setBody($body);
        }

        foreach ($headers as $key => $value) {
            if (is_int($key)) {
                if (str_contains($value, ':')) {
                    [$hName, $hValue] = explode(':', $value, 2);
                    $request->setHeader(trim($hName), trim($hValue));
                }
            } else {
                $request->setHeader((string) $key, (string) $value);
            }
        }

        $cancellation = new TimeoutCancellation($timeout);
        $response = self::getClient()->request($request, $cancellation);

        return [
            'status' => $response->getStatus(),
            'body' => $response->getBody()->buffer($cancellation),
            'headers' => $response->getHeaders(),
        ];
    }
}
