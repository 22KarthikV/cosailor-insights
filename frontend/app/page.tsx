import { Suspense } from 'react';
import { LeadsGrid } from '@/components/LeadsGrid';
import { Skeleton } from '@/components/ui/skeleton';
import { getLeads } from '@/lib/api';
import type { Lead } from '@/lib/types';

async function LeadsSection() {
  let leads: Lead[] = [];
  try {
    leads = await getLeads();
  } catch {
    // Backend not running — show empty state
  }
  return <LeadsGrid leads={leads} />;
}

export default function DashboardPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">🏠 Cosailor Insights</h1>
        <p className="text-sm text-gray-500 mt-1">
          GAF Roofing Contractors · ZIP 10013 · 25-mile radius
        </p>
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
