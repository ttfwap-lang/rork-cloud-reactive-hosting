<?php

declare(strict_types=1);

namespace ReplyFlow\Tests;

use PHPUnit\Framework\TestCase;
use ReplyFlow\ConnectorException;
use ReplyFlow\WorkerClient;
use TypeError;

final class WorkerClientTest extends TestCase
{
    public function testEncodingFailureThrowsConnectorExceptionNotTypeError(): void
    {
        putenv('CONTROL_PLANE_URL=https://worker.example.com');
        putenv('CONNECTOR_SHARED_SECRET=test_secret_must_be_at_least_24_chars_long');

        // Invalid UTF-8 sequence causes json_encode to throw JsonException
        $invalidPayload = [
            'bad_text' => "\xB1\x31",
        ];

        try {
            WorkerClient::post('/connector/event', $invalidPayload);
            $this->fail('Expected ConnectorException to be thrown');
        } catch (ConnectorException $e) {
            $this->assertSame(400, $e->httpStatus);
            $this->assertNotNull($e->getPrevious());
            $this->assertInstanceOf(\Throwable::class, $e->getPrevious());
            $this->assertStringContainsString('Failed to encode worker request payload', $e->getMessage());
        } catch (TypeError $e) {
            $this->fail('TypeError was thrown instead of ConnectorException: '.$e->getMessage());
        }
    }

    public function testNetworkFailureThrowsConnectorExceptionNotTypeError(): void
    {
        // Pointing to an invalid unreachable port triggers AsyncHttpClient error
        putenv('CONTROL_PLANE_URL=http://127.0.0.1:59999');
        putenv('CONNECTOR_SHARED_SECRET=test_secret_must_be_at_least_24_chars_long');

        try {
            WorkerClient::post('/connector/event', ['test' => 'data'], timeout: 0.1);
            $this->fail('Expected ConnectorException to be thrown');
        } catch (ConnectorException $e) {
            $this->assertSame(502, $e->httpStatus);
            $this->assertNotNull($e->getPrevious());
            $this->assertInstanceOf(\Throwable::class, $e->getPrevious());
            $this->assertStringContainsString('Worker request failed', $e->getMessage());
        } catch (TypeError $e) {
            $this->fail('TypeError was thrown instead of ConnectorException: '.$e->getMessage());
        }
    }

    public function testMissingControlPlaneUrlThrowsConnectorException(): void
    {
        putenv('CONTROL_PLANE_URL=');

        $this->expectException(ConnectorException::class);
        $this->expectExceptionMessage('CONTROL_PLANE_URL is not configured.');

        WorkerClient::post('/connector/event', ['test' => 'data']);
    }
}
