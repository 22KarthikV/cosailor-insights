'use client';

/**
 * LeadsGridClient — interactive leads grid with filtering, sorting, and real-time updates.
 *
 * This is the only client component on the dashboard. It receives an initial
 * leads array from the Server Component (LeadsSection in page.tsx) and keeps
 * it live via useLeadsRealtime (Supabase Postgres change subscriptions).
 *
 * Sub-components are extracted to keep the root component under 50 lines:
 *   StatChip          — single statistic tile
 *   StatsBar          — row of StatChips (total, avg score, enriched count)
 *   LeadFilterControls — score-tier filter buttons and sort selector
 */
import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { LeadCard } from './LeadCard';
import type { Lead } from '@/lib/types';
import { useLeadsRealtime } from '@/hooks/useLeadsRealtime';

type ScoreFilter = 'all' | 'high' | 'medium' | 'low';
type SortOption = 'score_desc' | 'name_asc' | 'recently_enriched';

interface LeadsGridClientProps {
  leads: Lead[];
  page: number;
  limit: number;
  total: number;
}

interface StatChipProps {
  label: string;
  value: string | number;
}

/** A single labelled statistic tile shown in the stats bar. */
function StatChip({ label, value }: StatChipProps) {
  return (
    <div className="rounded-lg border bg-gray-50 px-4 py-2 flex flex-col gap-0.5 min-w-25">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-lg font-bold text-gray-900 leading-tight">{value}</span>
    </div>
  );
}

/** Derive summary statistics from the current leads array. */
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

/** Filter leads by score tier. Leads without a score are excluded from tier-specific filters. */
function filterLeads(leads: Lead[], filter: ScoreFilter): Lead[] {
  if (filter === 'all') return leads;
  return leads.filter((l) => {
    if (l.lead_score === null) return false;
    if (filter === 'high') return l.lead_score >= 8 && l.lead_score <= 10;
    if (filter === 'medium') return l.lead_score >= 5 && l.lead_score <= 7;
    if (filter === 'low') return l.lead_score >= 0 && l.lead_score <= 4;
    return true;
  });
}

/** Sort leads without mutating the input array. */
function sortLeads(leads: Lead[], sort: SortOption): Lead[] {
  return [...leads].sort((a, b) => {
    if (sort === 'score_desc') {
      // Leads with no score sort to the bottom
      const aScore = a.lead_score ?? -1;
      const bScore = b.lead_score ?? -1;
      return bScore - aScore;
    }
    if (sort === 'name_asc') {
      return a.company_name.localeCompare(b.company_name);
    }
    if (sort === 'recently_enriched') {
      // Unenriched leads (enriched_at = null) sort to the bottom
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
      <StatChip label="This Page" value={total} />
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
      {/* Segmented score-tier filter */}
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

      {/* Result count only shown when a filter is active */}
      {scoreFilter !== 'all' && (
        <span className="text-xs text-gray-400">
          {resultCount} result{resultCount !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}

const PAGE_SIZE_OPTIONS = [12, 24, 48] as const;

interface PaginationControlsProps {
  page: number;
  limit: number;
  total: number;
}

function PaginationControls({ page, limit, total }: PaginationControlsProps): React.JSX.Element {
  const router = useRouter();
  const totalPages = Math.ceil(total / limit);
  const startItem = total === 0 ? 0 : (page - 1) * limit + 1;
  const endItem = Math.min(page * limit, total);

  const navigate = (newPage: number, newLimit: number) => {
    const params = new URLSearchParams();
    params.set('page', String(newPage));
    params.set('limit', String(newLimit));
    router.push(`/?${params.toString()}`);
  };

  return (
    <div className="flex items-center justify-between flex-wrap gap-3 mt-4">
      <span className="text-xs text-gray-500">
        {total === 0 ? 'No leads' : `Showing ${startItem}–${endItem} of ${total} leads`}
      </span>

      <div className="flex items-center gap-2">
        <label htmlFor="page-size" className="text-xs text-gray-500">
          Per page:
        </label>
        <select
          id="page-size"
          value={limit}
          onChange={(e) => navigate(1, Number(e.target.value))}
          className="border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => navigate(page - 1, limit)}
          disabled={page <= 1}
          className="px-3 py-1 text-xs rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Prev
        </button>
        <span className="text-xs text-gray-500">
          {page} / {totalPages || 1}
        </span>
        <button
          type="button"
          onClick={() => navigate(page + 1, limit)}
          disabled={page >= totalPages}
          className="px-3 py-1 text-xs rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function LeadsGridClient({ leads: initialLeads, page, limit, total }: LeadsGridClientProps): React.JSX.Element {
  // Merge real-time Supabase updates on top of the server-fetched initial state
  const leads = useLeadsRealtime(initialLeads)
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>('all');
  const [sortOption, setSortOption] = useState<SortOption>('score_desc');

  const { total: pageTotal, enrichedCount, avgScore } = useMemo(() => computeStats(leads), [leads]);
  const displayedLeads = useMemo(
    () => sortLeads(filterLeads(leads, scoreFilter), sortOption),
    [leads, scoreFilter, sortOption]
  );

  if (leads.length === 0) {
    return (
      <div className="text-center py-16 text-gray-500">
        <div className="text-5xl mb-4">📋</div>
        <p className="text-lg font-medium text-gray-700">No leads yet</p>
        <p className="text-sm text-gray-500 mt-1">
          Run the pipeline to scrape and enrich GAF contractors.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <StatsBar
        total={pageTotal}
        enrichedCount={enrichedCount}
        avgScore={avgScore !== null ? avgScore.toFixed(1) : '—'}
      />
      <p className="text-xs text-gray-400 mb-2">{total} contractors total</p>
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
            <div
              key={lead.id}
              className="animate-in fade-in slide-in-from-bottom-2 duration-300 h-full"
            >
              <LeadCard lead={lead} />
            </div>
          ))}
        </div>
      )}
      <PaginationControls page={page} limit={limit} total={total} />
    </div>
  );
}
