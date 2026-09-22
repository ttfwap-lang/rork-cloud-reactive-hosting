<?php

declare(strict_types=1);

namespace ReplyFlow\Tests;

use PHPUnit\Framework\TestCase;
use ReplyFlow\ConnectorException;
use ReplyFlow\GeminiClient;
use TypeError;

final class GeminiClientTest extends TestCase
{
    public function testEncodingFailureThrowsConnectorExceptionNotTypeError(): void
    {
        $client = new GeminiClient(apiKey: 'dummy_api_key', baseUrl: 'https://gemini.example.com');

        // Invalid UTF-8 sequence causes json_encode to throw JsonException
        $invalidContents = [
            [
                'parts' => [
                    ['text' => "\xB1\x31"],
                ],
            ],
        ];

        try {
            $client->generateContent($invalidContents);
            $this->fail('Expected ConnectorException to be thrown');
        } catch (ConnectorException $e) {
            $this->assertSame(400, $e->httpStatus);
            $this->assertNotNull($e->getPrevious());
            $this->assertInstanceOf(\Throwable::class, $e->getPrevious());
            $this->assertStringContainsString('Failed to encode Gemini request payload', $e->getMessage());
        } catch (TypeError $e) {
            $this->fail('TypeError was thrown instead of ConnectorException: '.$e->getMessage());
        }
    }

    public function testNetworkFailureThrowsConnectorExceptionNotTypeError(): void
    {
        // Unreachable port triggers AsyncHttpClient error
        $client = new GeminiClient(
            apiKey: 'dummy_api_key',
            baseUrl: 'http://127.0.0.1:59999',
        );

        try {
            $client->generateContent([['parts' => [['text' => 'hello']]]], timeout: 0.1);
            $this->fail('Expected ConnectorException to be thrown');
        } catch (ConnectorException $e) {
            $this->assertSame(502, $e->httpStatus);
            $this->assertNotNull($e->getPrevious());
            $this->assertInstanceOf(\Throwable::class, $e->getPrevious());
            $this->assertStringContainsString('Gemini HTTP request failed', $e->getMessage());
        } catch (TypeError $e) {
            $this->fail('TypeError was thrown instead of ConnectorException: '.$e->getMessage());
        }
    }

    public function testMissingApiKeyThrowsConnectorException(): void
    {
        $client = new GeminiClient(apiKey: '');

        $this->expectException(ConnectorException::class);
        $this->expectExceptionMessage('GEMINI_API_KEY is not configured.');

        $client->generateContent([['parts' => [['text' => 'hello']]]]);
    }
}
