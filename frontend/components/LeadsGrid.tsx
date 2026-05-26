import { LeadCard } from './LeadCard';
import type { Lead } from '@/lib/types';

export function LeadsGrid({ leads }: { leads: Lead[] }) {
  if (leads.length === 0) {
    return (
      <div className="text-center py-24">
        <div className="text-5xl mb-4">🏠</div>
        <p className="text-lg font-medium text-gray-500">No leads yet</p>
        <p className="text-sm text-gray-400 mt-1">Run the pipeline to generate leads.</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {leads.map((lead) => (
        <LeadCard key={lead.id} lead={lead} />
      ))}
    </div>
  );
}
