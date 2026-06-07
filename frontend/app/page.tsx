import { Suspense } from 'react';
import { LeadsGridClient } from '@/components/LeadsGridClient';
import { PipelineControls } from '@/components/PipelineControls';
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
      <div
        className="mt-4 px-4 py-3 rounded-lg text-sm"
        style={{
          background: 'rgba(255,71,87,0.08)',
          border: '1px solid rgba(255,71,87,0.2)',
          color: '#FF4757',
        }}
      >
        Unable to load leads. Make sure the backend is running on port 8000.
      </div>
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

function GridSkeleton() {
  return (
    <div className="space-y-5">
      {/* Stats bar skeleton */}
      <div className="flex flex-wrap gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="shimmer-block h-16 w-28 rounded-lg" />
        ))}
      </div>
      {/* Filter row skeleton */}
      <div className="flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="shimmer-block h-7 w-20 rounded-full" />
        ))}
      </div>
      {/* Grid skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="shimmer-block h-44 rounded-xl" />
        ))}
      </div>
    </div>
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
    <div className="min-h-screen" style={{ background: '#08090C' }}>
      {/* Top command bar */}
      <header
        className="sticky top-0 z-20 px-6 py-4"
        style={{
          background: 'rgba(8,9,12,0.85)',
          borderBottom: '1px solid #1C2333',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <div className="max-w-7xl mx-auto flex items-start justify-between gap-6 flex-wrap">
          {/* Brand */}
          <div>
            <h1
              className="text-xl font-heading font-bold tracking-tight"
              style={{ color: '#E8ECF4' }}
            >
              Cosailor Insights
            </h1>
            <p className="text-xs mt-0.5" style={{ color: '#3D4558' }}>
              GAF Roofing&nbsp;·&nbsp;Commercial&nbsp;·&nbsp;United States
            </p>
          </div>

          {/* Pipeline controls */}
          <PipelineControls />
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <Suspense fallback={<GridSkeleton />}>
          <LeadsSection
            page={page}
            limit={limit}
            scoreTier={scoreTier}
            sortBy={sortBy}
          />
        </Suspense>
      </main>
    </div>
  );
}
