<?php

declare(strict_types=1);

namespace ReplyFlow\Tests\Agent;

use PHPUnit\Framework\TestCase;
use ReplyFlow\Agent\CompactionPolicy;

final class CompactionPolicyTest extends TestCase
{
    public function testNoCompactionWhenHealthy(): void
    {
        $policy = new CompactionPolicy(
            minFreeBytes: 50 * 1024 * 1024,
            minFreePercent: 10.0,
            maxTenantLogBytes: 25 * 1024 * 1024,
        );

        // 500 MB free of 1 GB, tenant log 5 MB
        $freeBytes = 500 * 1024 * 1024;
        $totalBytes = 1024 * 1024 * 1024;
        $tenantLogBytes = 5 * 1024 * 1024;

        $this->assertFalse($policy->shouldCompact($freeBytes, $totalBytes, $tenantLogBytes));
        $this->assertSame('none', $policy->compactionReason($freeBytes, $totalBytes, $tenantLogBytes));
    }

    public function testCompactsWhenTenantLogCapExceeded(): void
    {
        $policy = new CompactionPolicy(
            minFreeBytes: 50 * 1024 * 1024,
            minFreePercent: 10.0,
            maxTenantLogBytes: 25 * 1024 * 1024,
        );

        $freeBytes = 500 * 1024 * 1024;
        $totalBytes = 1024 * 1024 * 1024;
        $tenantLogBytes = 26 * 1024 * 1024; // > 25MB

        $this->assertTrue($policy->shouldCompact($freeBytes, $totalBytes, $tenantLogBytes));
        $this->assertSame('tenant_log_cap_exceeded', $policy->compactionReason($freeBytes, $totalBytes, $tenantLogBytes));
    }

    public function testCompactsWhenDiskFreeBytesLow(): void
    {
        $policy = new CompactionPolicy(
            minFreeBytes: 50 * 1024 * 1024,
            minFreePercent: 1.0,
            maxTenantLogBytes: 25 * 1024 * 1024,
        );

        $freeBytes = 40 * 1024 * 1024; // < 50MB
        $totalBytes = 1024 * 1024 * 1024;
        $tenantLogBytes = 2 * 1024 * 1024;

        $this->assertTrue($policy->shouldCompact($freeBytes, $totalBytes, $tenantLogBytes));
        $this->assertSame('disk_free_bytes_low', $policy->compactionReason($freeBytes, $totalBytes, $tenantLogBytes));
    }

    public function testCompactsWhenDiskFreePercentLow(): void
    {
        $policy = new CompactionPolicy(
            minFreeBytes: 10 * 1024 * 1024,
            minFreePercent: 10.0,
            maxTenantLogBytes: 25 * 1024 * 1024,
        );

        // 50 MB free on a 1 GB disk = ~5%, which is < 10%
        $freeBytes = 50 * 1024 * 1024;
        $totalBytes = 1000 * 1024 * 1024;
        $tenantLogBytes = 2 * 1024 * 1024;

        $this->assertTrue($policy->shouldCompact($freeBytes, $totalBytes, $tenantLogBytes));
        $this->assertSame('disk_free_percent_low', $policy->compactionReason($freeBytes, $totalBytes, $tenantLogBytes));
    }
}
