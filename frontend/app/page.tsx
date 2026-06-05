/**
 * Dashboard page — the application's home route ("/").
 *
 * This is an async Server Component. It renders a header with score-tier
 * legend and PipelineControls, then lazily streams the leads grid via Suspense.
 *
 * LeadsSection fetches leads server-side on each request (cache: 'no-store').
 * A failed fetch is caught and swallowed so the page renders an empty grid
 * rather than crashing when the backend is not running.
 */
import { Suspense } from 'react';
import { LeadsGridClient } from '@/components/LeadsGridClient';
import { PipelineControls } from '@/components/PipelineControls';
import { Skeleton } from '@/components/ui/skeleton';
import { getCachedLeads } from '@/lib/leads';
import type { Lead } from '@/lib/types';

/** Async sub-component that fetches leads and passes them to the client grid. */
async function LeadsSection() {
  let leads: Lead[] = [];
  try {
    const data = await getCachedLeads(1, 12);
    leads = data.leads;
  } catch (err) {
    console.error('[LeadsSection] Failed to fetch leads:', err);
    /* backend not running or returned an error — render empty state */
  }
  return <LeadsGridClient leads={leads} />;
}

export default function DashboardPage() {
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

        {/* Score-tier legend: maps colour coding to lead_score ranges */}
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
        <LeadsSection />
      </Suspense>
    </div>
  );
}
