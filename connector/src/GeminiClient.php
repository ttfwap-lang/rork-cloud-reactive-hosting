<?php

declare(strict_types=1);

namespace ReplyFlow;

use Throwable;

/**
 * Async Gemini client shell.
 * Provides transport and request/response structure without turn loop or tool dispatching.
 */
final class GeminiClient
{
    private const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
    public const DEFAULT_MODEL = 'gemini-2.5-flash';

    private string $apiKey;
    private string $model;
    private string $baseUrl;

    public function __construct(?string $apiKey = null, ?string $model = null, ?string $baseUrl = null)
    {
        $this->apiKey = $apiKey ?? (string) (getenv('GEMINI_API_KEY') ?: '');
        $this->model = $model ?? self::DEFAULT_MODEL;
        $this->baseUrl = rtrim($baseUrl ?? (getenv('GEMINI_BASE_URL') ?: self::DEFAULT_BASE_URL), '/');
    }

    public function getModel(): string
    {
        return $this->model;
    }

    /**
     * Sends a generateContent request to Gemini and returns the parsed response.
     *
     * @param list<array> $contents Gemini content parts
     * @param list<array> $tools Function declarations / tool configurations
     * @param array<string, mixed>|null $systemInstruction System instructions
     * @param array<string, mixed>|null $generationConfig Temperature, maxOutputTokens, etc.
     * @return array<string, mixed>
     * @throws ConnectorException on network, API, or decoding error
     */
    public function generateContent(
        array $contents,
        array $tools = [],
        ?array $systemInstruction = null,
        ?array $generationConfig = null,
        float $timeout = 60.0,
    ): array {
        if ($this->apiKey === '') {
            throw new ConnectorException('GEMINI_API_KEY is not configured.', null, 500);
        }

        $url = sprintf('%s/models/%s:generateContent?key=%s', $this->baseUrl, urlencode($this->model), urlencode($this->apiKey));

        $payload = [
            'contents' => $contents,
        ];
        if (count($tools) > 0) {
            $payload['tools'] = $tools;
        }
        if ($systemInstruction !== null && count($systemInstruction) > 0) {
            $payload['systemInstruction'] = $systemInstruction;
        }
        if ($generationConfig !== null && count($generationConfig) > 0) {
            $payload['generationConfig'] = $generationConfig;
        }

        try {
            $jsonBody = json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        } catch (Throwable $e) {
            throw new ConnectorException('Failed to encode Gemini request payload: '.$e->getMessage(), null, 400, $e);
        }

        try {
            $response = AsyncHttpClient::request(
                'POST',
                $url,
                ['Content-Type: application/json'],
                $jsonBody,
                $timeout,
            );
        } catch (Throwable $e) {
            throw new ConnectorException('Gemini HTTP request failed: '.$e->getMessage(), null, 502, $e);
        }

        $status = $response['status'];
        $rawBody = $response['body'];
        try {
            $decoded = json_decode($rawBody, true, flags: JSON_THROW_ON_ERROR);
        } catch (Throwable $e) {
            throw new ConnectorException('Failed to decode Gemini response: '.$e->getMessage(), null, 502, $e);
        }

        if ($status < 200 || $status >= 300) {
            $msg = is_array($decoded) && isset($decoded['error']['message'])
                ? (string) $decoded['error']['message']
                : 'Gemini request failed with status '.$status;
            throw new ConnectorException($msg, null, $status);
        }

        return is_array($decoded) ? $decoded : [];
    }
}
