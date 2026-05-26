'use client';

import React, { useState, useMemo } from 'react';
import { LeadCard } from './LeadCard';
import type { Lead } from '@/lib/types';

type ScoreFilter = 'all' | 'high' | 'medium' | 'low';
type SortOption = 'score_desc' | 'name_asc' | 'recently_enriched';

interface LeadsGridClientProps {
  leads: Lead[];
}

interface StatChipProps {
  label: string;
  value: string | number;
}

function StatChip({ label, value }: StatChipProps) {
  return (
    <div className="rounded-lg border bg-gray-50 px-4 py-2 flex flex-col gap-0.5 min-w-[100px]">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-lg font-bold text-gray-900 leading-tight">{value}</span>
    </div>
  );
}

function computeStats(leads: Lead[]) {
  const total = leads.length;
  const enrichedLeads = leads.filter((l) => l.status === 'enriched');
  const enrichedCount = enrichedLeads.length;
  const scoredLeads = leads.filter((l) => l.status === 'enriched' && l.lead_score !== null);
  const avgScore =
    scoredLeads.length > 0
      ? scoredLeads.reduce((sum, l) => sum + (l.lead_score as number), 0) / scoredLeads.length
      : null;

  return { total, enrichedCount, avgScore };
}

function filterLeads(leads: Lead[], filter: ScoreFilter): Lead[] {
  if (filter === 'all') return leads;
  return leads.filter((l) => {
    if (l.lead_score === null) return false;
    if (filter === 'high') return l.lead_score >= 8 && l.lead_score <= 10;
    if (filter === 'medium') return l.lead_score >= 5 && l.lead_score <= 7;
    if (filter === 'low') return l.lead_score >= 1 && l.lead_score <= 4;
    return true;
  });
}

function sortLeads(leads: Lead[], sort: SortOption): Lead[] {
  return [...leads].sort((a, b) => {
    if (sort === 'score_desc') {
      const aScore = a.lead_score ?? -1;
      const bScore = b.lead_score ?? -1;
      return bScore - aScore;
    }
    if (sort === 'name_asc') {
      return a.company_name.localeCompare(b.company_name);
    }
    if (sort === 'recently_enriched') {
      const aTime = a.enriched_at ? new Date(a.enriched_at).getTime() : 0;
      const bTime = b.enriched_at ? new Date(b.enriched_at).getTime() : 0;
      return bTime - aTime;
    }
    return 0;
  });
}

const SCORE_FILTER_OPTIONS: { value: ScoreFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'high', label: 'High (8-10)' },
  { value: 'medium', label: 'Medium (5-7)' },
  { value: 'low', label: 'Low (1-4)' },
];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'score_desc', label: 'Score (High to Low)' },
  { value: 'name_asc', label: 'Name (A to Z)' },
  { value: 'recently_enriched', label: 'Recently Enriched' },
];

interface StatsBarProps {
  total: number;
  enrichedCount: number;
  avgScore: string;
}

function StatsBar({ total, enrichedCount, avgScore }: StatsBarProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-3">
      <StatChip label="Total Leads" value={total} />
      <StatChip label="Avg Score" value={avgScore} />
      <StatChip label="Enriched" value={`${enrichedCount} / ${total}`} />
    </div>
  );
}

interface LeadFilterControlsProps {
  scoreFilter: ScoreFilter;
  sortOption: SortOption;
  resultCount: number;
  onFilterChange: (f: ScoreFilter) => void;
  onSortChange: (s: SortOption) => void;
}

function LeadFilterControls({
  scoreFilter,
  sortOption,
  resultCount,
  onFilterChange,
  onSortChange,
}: LeadFilterControlsProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        className="flex items-center gap-0 rounded border border-gray-200 overflow-hidden"
        role="group"
        aria-label="Filter by score"
      >
        {SCORE_FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onFilterChange(opt.value)}
            className={
              'px-3 py-1 text-xs border-r border-gray-200 last:border-r-0 transition-colors ' +
              (scoreFilter === opt.value
                ? 'bg-blue-600 text-white font-medium'
                : 'bg-white text-gray-600 hover:bg-gray-100')
            }
            aria-pressed={scoreFilter === opt.value}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <select
        value={sortOption}
        onChange={(e) => onSortChange(e.target.value as SortOption)}
        className="border border-gray-200 rounded px-3 py-1 text-xs text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        aria-label="Sort leads"
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {scoreFilter !== 'all' && (
        <span className="text-xs text-gray-400">
          {resultCount} result{resultCount !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}

export function LeadsGridClient({ leads }: LeadsGridClientProps): React.JSX.Element {
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>('all');
  const [sortOption, setSortOption] = useState<SortOption>('score_desc');

  const { total, enrichedCount, avgScore } = useMemo(() => computeStats(leads), [leads]);
  const displayedLeads = useMemo(
    () => sortLeads(filterLeads(leads, scoreFilter), sortOption),
    [leads, scoreFilter, sortOption]
  );

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
    <div className="space-y-4">
      <StatsBar
        total={total}
        enrichedCount={enrichedCount}
        avgScore={avgScore !== null ? avgScore.toFixed(1) : '—'}
      />
      <LeadFilterControls
        scoreFilter={scoreFilter}
        sortOption={sortOption}
        resultCount={displayedLeads.length}
        onFilterChange={setScoreFilter}
        onSortChange={setSortOption}
      />
      {displayedLeads.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500 text-sm">No leads match the selected filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {displayedLeads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} />
          ))}
        </div>
      )}
    </div>
  );
}
