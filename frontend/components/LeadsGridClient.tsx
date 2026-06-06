'use client';

/**
 * LeadsGridClient — interactive leads grid with URL-driven filtering, sorting,
 * and real-time updates.
 *
 * Filtering and sorting are now server-side: filter/sort controls push new URL
 * params, which re-runs the Server Component (LeadsSection) so the backend
 * returns an accurate filtered total and the correct page of results.
 * No client-side filter/sort logic remains here.
 *
 * Sub-components:
 *   StatChip          — single statistic tile
 *   StatsBar          — row of StatChips (page count, avg score, enriched count)
 *   LeadFilterControls — score-tier filter buttons and sort selector (URL-driven)
 *   PaginationControls — prev/next/page-size (preserves score_tier & sort_by)
 */
import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { LeadCard } from './LeadCard';
import type { Lead } from '@/lib/types';
import { useLeadsRealtime } from '@/hooks/useLeadsRealtime';

type ScoreTier = 'all' | 'high' | 'medium' | 'low';
type SortOption = 'score_desc' | 'name_asc' | 'recently_enriched';

interface LeadsGridClientProps {
  leads: Lead[];
  page: number;
  limit: number;
  total: number;
  scoreTier: ScoreTier;
  sortBy: SortOption;
}

interface StatChipProps {
  label: string;
  value: string | number;
}

function StatChip({ label, value }: StatChipProps) {
  return (
    <div className="rounded-lg border bg-gray-50 px-4 py-2 flex flex-col gap-0.5 min-w-25">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-lg font-bold text-gray-900 leading-tight">{value}</span>
    </div>
  );
}

function computeStats(leads: Lead[]) {
  const enrichedLeads = leads.filter((l) => l.status === 'enriched');
  const enrichedCount = enrichedLeads.length;
  const scoredLeads = leads.filter((l) => l.status === 'enriched' && l.lead_score !== null);
  const avgScore =
    scoredLeads.length > 0
      ? scoredLeads.reduce((sum, l) => sum + (l.lead_score as number), 0) / scoredLeads.length
      : null;
  return { enrichedCount, avgScore };
}

interface StatsBarProps {
  pageCount: number;
  enrichedCount: number;
  avgScore: string;
}

function StatsBar({ pageCount, enrichedCount, avgScore }: StatsBarProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-3">
      <StatChip label="This Page" value={pageCount} />
      <StatChip label="Avg Score" value={avgScore} />
      <StatChip label="Enriched" value={`${enrichedCount} / ${pageCount}`} />
    </div>
  );
}

const SCORE_FILTER_OPTIONS: { value: ScoreTier; label: string }[] = [
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

interface LeadFilterControlsProps {
  scoreTier: ScoreTier;
  sortBy: SortOption;
  filteredTotal: number;
  onFilterChange: (f: ScoreTier) => void;
  onSortChange: (s: SortOption) => void;
}

function LeadFilterControls({
  scoreTier,
  sortBy,
  filteredTotal,
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
              (scoreTier === opt.value
                ? 'bg-blue-600 text-white font-medium'
                : 'bg-white text-gray-600 hover:bg-gray-100')
            }
            aria-pressed={scoreTier === opt.value}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <select
        value={sortBy}
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

      {scoreTier !== 'all' && (
        <span className="text-xs text-gray-400">
          {filteredTotal} result{filteredTotal !== 1 ? 's' : ''}
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
  scoreTier: ScoreTier;
  sortBy: SortOption;
}

function PaginationControls({ page, limit, total, scoreTier, sortBy }: PaginationControlsProps): React.JSX.Element {
  const router = useRouter();
  const totalPages = Math.ceil(total / limit);
  const startItem = total === 0 ? 0 : (page - 1) * limit + 1;
  const endItem = Math.min(page * limit, total);

  const navigate = (newPage: number, newLimit: number) => {
    const params = new URLSearchParams();
    params.set('page', String(newPage));
    params.set('limit', String(newLimit));
    if (scoreTier !== 'all') params.set('score_tier', scoreTier);
    if (sortBy !== 'score_desc') params.set('sort_by', sortBy);
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

export function LeadsGridClient({
  leads: initialLeads,
  page,
  limit,
  total,
  scoreTier,
  sortBy,
}: LeadsGridClientProps): React.JSX.Element {
  const router = useRouter();
  const leads = useLeadsRealtime(initialLeads, page, limit, scoreTier, sortBy);

  const { enrichedCount, avgScore } = useMemo(() => computeStats(leads), [leads]);

  const pushFilter = (f: ScoreTier) => {
    const params = new URLSearchParams();
    params.set('page', '1');
    params.set('limit', String(limit));
    if (f !== 'all') params.set('score_tier', f);
    if (sortBy !== 'score_desc') params.set('sort_by', sortBy);
    router.push(`/?${params.toString()}`);
  };

  const pushSort = (s: SortOption) => {
    const params = new URLSearchParams();
    params.set('page', '1');
    params.set('limit', String(limit));
    if (scoreTier !== 'all') params.set('score_tier', scoreTier);
    if (s !== 'score_desc') params.set('sort_by', s);
    router.push(`/?${params.toString()}`);
  };

  if (scoreTier === 'all' && total === 0) {
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
        pageCount={leads.length}
        enrichedCount={enrichedCount}
        avgScore={avgScore !== null ? avgScore.toFixed(1) : '—'}
      />
      <p className="text-xs text-gray-400 mb-2">{total} contractors total</p>
      <LeadFilterControls
        scoreTier={scoreTier}
        sortBy={sortBy}
        filteredTotal={total}
        onFilterChange={pushFilter}
        onSortChange={pushSort}
      />
      {leads.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500 text-sm">No leads match the selected filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {leads.map((lead) => (
            <div
              key={lead.id}
              className="animate-in fade-in slide-in-from-bottom-2 duration-300 h-full"
            >
              <LeadCard lead={lead} page={page} limit={limit} />
            </div>
          ))}
        </div>
      )}
      <PaginationControls
        page={page}
        limit={limit}
        total={total}
        scoreTier={scoreTier}
        sortBy={sortBy}
      />
    </div>
  );
}
