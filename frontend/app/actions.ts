'use server';

/**
 * Server actions for cache management.
 *
 * revalidateLeads() is called by PipelineControls on every poll during a
 * pipeline run (to force fresh data) and once more when the run completes
 * (to populate the cache with the final enriched state).
 */
import { revalidateTag } from 'next/cache';

export async function revalidateLeads(): Promise<void> {
  revalidateTag('leads-list');
}
