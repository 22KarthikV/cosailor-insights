/**
 * Server-side leads fetch — no caching layer.
 *
 * getLeads uses cache: 'no-store' so every call goes straight to the backend.
 * This ensures that router.refresh() (called by PipelineControls every 3 s
 * during a pipeline run) always delivers fresh data — new scraped cards appear
 * and the total count updates without needing cache invalidation.
 */
import { getLeads } from './api';
import type { PaginatedLeadsResponse } from './types';

export function getCachedLeads(
  page: number,
  limit: number,
  scoreTier?: string,
  sortBy?: string,
): Promise<PaginatedLeadsResponse> {
  return getLeads(page, limit, scoreTier, sortBy);
}
