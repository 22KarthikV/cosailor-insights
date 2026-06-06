/**
 * Dashboard page — the application's home route ("/").
 *
 * Reads page and limit from URL searchParams so pagination is URL-driven
 * (shareable, back-button safe). Falls back to page=1, limit=12 when absent.
 * Uses getCachedLeads() so post-run loads are served from the Next.js cache.
 * During a pipeline run the cache is busted every 3 s by PipelineControls.
 */
import { Suspense } from 'react';
import { LeadsGridClient } from '@/components/LeadsGridClient';
import { PipelineControls } from '@/components/PipelineControls';
import { Skeleton } from '@/components/ui/skeleton';
import { getCachedLeads } from '@/lib/leads';
import type { Lead } from '@/lib/types';

const PAGE_SIZE_OPTIONS = [12, 24, 48] as const;

const VALID_SCORE_TIERS = ['all', 'high', 'medium', 'low'] as const;
type ScoreTier = (typeof VALID_SCORE_TIERS)[number];
const VALID_SORT_OPTIONS = ['score_desc', 'name_asc', 'recently_enriched'] as const;
type SortOption = (typeof VALID_SORT_OPTIONS)[number];

interface LeadsSectionProps {
  page: number;
  limit: number;
  scoreTier: ScoreTier;
  sortBy: SortOption;
}

async function LeadsSection({ page, limit, scoreTier, sortBy }: LeadsSectionProps) {
  let leads: Lead[] = [];
  let total = 0;
  let fetchError = false;
  try {
    const result = await getCachedLeads(page, limit, scoreTier, sortBy);
    leads = result.leads;
    total = result.total;
  } catch (err) {
    console.error('[LeadsSection] Failed to fetch leads:', err);
    fetchError = true;
  }
  if (fetchError) {
    return (
      <p className="text-sm text-red-500 mt-4">
        Unable to load leads. Make sure the backend is running on port 8000.
      </p>
    );
  }
  return (
    <LeadsGridClient
      leads={leads}
      page={page}
      limit={limit}
      total={total}
      scoreTier={scoreTier}
      sortBy={sortBy}
    />
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; limit?: string; score_tier?: string; sort_by?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const rawLimit = parseInt(params.limit ?? '12', 10);
  const limit = PAGE_SIZE_OPTIONS.includes(rawLimit as (typeof PAGE_SIZE_OPTIONS)[number])
    ? rawLimit
    : 12;
  const scoreTier = (VALID_SCORE_TIERS.includes(params.score_tier as ScoreTier)
    ? params.score_tier
    : 'all') as ScoreTier;
  const sortBy = (VALID_SORT_OPTIONS.includes(params.sort_by as SortOption)
    ? params.sort_by
    : 'score_desc') as SortOption;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Cosailor Insights</h1>
            <p className="text-sm text-gray-500 mt-1">
              GAF Roofing Contractors &middot; Commercial &middot; United States
            </p>
          </div>
          <PipelineControls />
        </div>

        <div className="flex items-center gap-4 mt-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-green-400 inline-block" />
            High priority (8-10)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-yellow-400 inline-block" />
            Medium (5-7)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-red-400 inline-block" />
            Low (1-4)
          </span>
        </div>
      </div>

      {/* Skeleton grid shown while LeadsSection is streaming */}
      <Suspense
        fallback={
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-48 rounded-lg" />
            ))}
          </div>
        }
      >
        <LeadsSection page={page} limit={limit} scoreTier={scoreTier} sortBy={sortBy} />
      </Suspense>
    </div>
  );
}
