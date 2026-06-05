/**
 * Cached leads fetch using Next.js unstable_cache.
 *
 * During a pipeline run, PipelineControls calls revalidateLeads() (in actions.ts)
 * before every router.refresh() to bust the cache and ensure fresh data.
 * After the run completes, the cache is left populated so subsequent page
 * loads are served instantly without a Supabase round-trip.
 *
 * Each page/limit combination gets its own cache entry; all share the
 * 'leads-list' tag so a single revalidateTag() invalidates all of them.
 */
import { unstable_cache } from 'next/cache';
import { getLeads } from './api';
import type { PaginatedLeadsResponse } from './types';

export function getCachedLeads(page: number, limit: number): Promise<PaginatedLeadsResponse> {
  return unstable_cache(
    () => getLeads(page, limit),
    ['leads-list', String(page), String(limit)],
    { tags: ['leads-list'] }
  )();
}
