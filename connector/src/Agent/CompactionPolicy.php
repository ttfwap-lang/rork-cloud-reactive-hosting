<?php

declare(strict_types=1);

namespace ReplyFlow\Agent;

/**
 * Pure compaction policy decision engine.
 * Determines whether emergency log compaction should trigger based on
 * disk volume free space or per-tenant log size limits.
 */
final class CompactionPolicy
{
    /** Default 50 MB minimum disk free space */
    public const DEFAULT_MIN_FREE_BYTES = 50 * 1024 * 1024;
    /** Default 10% minimum volume free space */
    public const DEFAULT_MIN_FREE_PERCENT = 10.0;
    /** Default 25 MB max per-tenant log size */
    public const DEFAULT_MAX_TENANT_LOG_BYTES = 25 * 1024 * 1024;

    public function __construct(
        public readonly int $minFreeBytes = self::DEFAULT_MIN_FREE_BYTES,
        public readonly float $minFreePercent = self::DEFAULT_MIN_FREE_PERCENT,
        public readonly int $maxTenantLogBytes = self::DEFAULT_MAX_TENANT_LOG_BYTES,
    ) {
    }

    /**
     * Decides whether emergency compaction should be requested.
     */
    public function shouldCompact(int $freeBytes, int $totalBytes, int $tenantLogBytes): bool
    {
        return $this->compactionReason($freeBytes, $totalBytes, $tenantLogBytes) !== 'none';
    }

    /**
     * Returns the trigger reason for compaction, or 'none'.
     */
    public function compactionReason(int $freeBytes, int $totalBytes, int $tenantLogBytes): string
    {
        if ($tenantLogBytes >= $this->maxTenantLogBytes) {
            return 'tenant_log_cap_exceeded';
        }

        if ($freeBytes < $this->minFreeBytes) {
            return 'disk_free_bytes_low';
        }

        if ($totalBytes > 0) {
            $freePercent = ($freeBytes / $totalBytes) * 100.0;
            if ($freePercent < $this->minFreePercent) {
                return 'disk_free_percent_low';
            }
        }

        return 'none';
    }
}
