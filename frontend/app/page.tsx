import { Suspense } from 'react';
import { LeadsGridClient } from '@/components/LeadsGridClient';
import { PipelineControls } from '@/components/PipelineControls';
import { Skeleton } from '@/components/ui/skeleton';
import { getLeads } from '@/lib/api';
import type { Lead } from '@/lib/types';

async function LeadsSection() {
  let leads: Lead[] = [];
  try {
    leads = await getLeads();
  } catch {
    /* backend not running */
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
              GAF Roofing Contractors &middot; ZIP 10013 &middot; 25-mile radius
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
