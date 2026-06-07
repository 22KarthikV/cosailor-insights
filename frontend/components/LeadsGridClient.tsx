'use client';

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

interface StatChipProps {
  label: string;
  value: string | number;
  accent?: string;
}

function StatChip({ label, value, accent }: StatChipProps) {
  return (
    <div
      className="flex flex-col gap-0.5 px-4 py-3 rounded-lg"
      style={{ background: '#0F1117', border: '1px solid #1C2333' }}
    >
      <span className="text-xs uppercase tracking-widest" style={{ color: '#3D4558' }}>
        {label}
      </span>
      <span
        className="text-xl font-bold font-heading leading-tight tabular-nums"
        style={{ color: accent ?? '#E8ECF4' }}
      >
        {value}
      </span>
    </div>
  );
}

interface StatsBarProps {
  pageCount: number;
  enrichedCount: number;
  avgScore: string;
}

function StatsBar({ pageCount, enrichedCount, avgScore }: StatsBarProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <StatChip label="This Page" value={pageCount} />
      <StatChip label="Avg Score" value={avgScore} accent="#00C8FF" />
      <StatChip label="Enriched" value={`${enrichedCount} / ${pageCount}`} accent="#00E87A" />
    </div>
  );
}

const SCORE_FILTER_OPTIONS: {
  value: ScoreTier;
  label: string;
  activeColor: string;
  activeBg: string;
}[] = [
  { value: 'all',    label: 'All',        activeColor: '#00C8FF', activeBg: 'rgba(0,200,255,0.12)' },
  { value: 'high',   label: 'High 8-10',  activeColor: '#00E87A', activeBg: 'rgba(0,232,122,0.12)' },
  { value: 'medium', label: 'Mid 5-7',    activeColor: '#FFB020', activeBg: 'rgba(255,176,32,0.12)' },
  { value: 'low',    label: 'Low 1-4',    activeColor: '#FF4757', activeBg: 'rgba(255,71,87,0.12)' },
];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'score_desc',       label: 'Score: High → Low' },
  { value: 'name_asc',         label: 'Name: A → Z' },
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
}: LeadFilterControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Score tier pills */}
      <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Filter by score tier">
        {SCORE_FILTER_OPTIONS.map((opt) => {
          const isActive = scoreTier === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onFilterChange(opt.value)}
              aria-pressed={isActive}
              className="px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150"
              style={{
                color: isActive ? opt.activeColor : '#7A8499',
                background: isActive ? opt.activeBg : 'transparent',
                border: `1px solid ${isActive ? opt.activeColor : '#1C2333'}`,
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Sort selector */}
      <div className="relative">
        <select
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value as SortOption)}
          aria-label="Sort leads"
          className="appearance-none pl-3 pr-7 py-1.5 rounded-lg text-xs font-medium cursor-pointer focus:outline-none"
          style={{
            background: '#161B22',
            border: '1px solid #2D3748',
            color: '#7A8499',
          }}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs"
          style={{ color: '#3D4558' }}
        >
          ▾
        </span>
      </div>

      {scoreTier !== 'all' && (
        <span className="text-xs font-mono" style={{ color: '#3D4558' }}>
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

function PaginationControls({ page, limit, total, scoreTier, sortBy }: PaginationControlsProps) {
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

  const btnBase: React.CSSProperties = {
    background: '#0F1117',
    border: '1px solid #1C2333',
    color: '#7A8499',
    borderRadius: '0.5rem',
    padding: '6px 12px',
    fontSize: '12px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  };

  return (
    <div className="flex items-center justify-between flex-wrap gap-3 mt-6 pt-4" style={{ borderTop: '1px solid #1C2333' }}>
      <span className="text-xs font-mono" style={{ color: '#3D4558' }}>
        {total === 0 ? 'No leads' : `${startItem}–${endItem} of ${total}`}
      </span>

      <div className="flex items-center gap-2">
        <label htmlFor="page-size" className="text-xs" style={{ color: '#3D4558' }}>
          Per page
        </label>
        <div className="relative">
          <select
            id="page-size"
            value={limit}
            onChange={(e) => navigate(1, Number(e.target.value))}
            className="appearance-none pl-3 pr-6 py-1.5 rounded-lg text-xs font-mono focus:outline-none cursor-pointer"
            style={{
              background: '#0F1117',
              border: '1px solid #1C2333',
              color: '#7A8499',
            }}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <span
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs"
            style={{ color: '#3D4558' }}
          >
            ▾
          </span>
        </div>

        <button
          type="button"
          onClick={() => navigate(page - 1, limit)}
          disabled={page <= 1}
          style={{ ...btnBase, opacity: page <= 1 ? 0.3 : 1, cursor: page <= 1 ? 'not-allowed' : 'pointer' }}
        >
          ←
        </button>

        <span className="text-xs font-mono px-2" style={{ color: '#7A8499' }}>
          {page} / {totalPages || 1}
        </span>

        <button
          type="button"
          onClick={() => navigate(page + 1, limit)}
          disabled={page >= totalPages}
          style={{ ...btnBase, opacity: page >= totalPages ? 0.3 : 1, cursor: page >= totalPages ? 'not-allowed' : 'pointer' }}
        >
          →
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
}: LeadsGridClientProps) {
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
      <div className="text-center py-24">
        <div
          className="text-5xl mb-6 font-mono"
          style={{ color: '#1C2333' }}
        >
          ◈
        </div>
        <p
          className="text-base font-heading font-semibold mb-1"
          style={{ color: '#7A8499' }}
        >
          No leads yet
        </p>
        <p className="text-sm" style={{ color: '#3D4558' }}>
          Run the pipeline to scrape and enrich GAF contractors.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <StatsBar
        pageCount={leads.length}
        enrichedCount={enrichedCount}
        avgScore={avgScore !== null ? avgScore.toFixed(1) : '—'}
      />

      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs font-mono" style={{ color: '#3D4558' }}>
          {total} contractors total
        </span>
      </div>

      <LeadFilterControls
        scoreTier={scoreTier}
        sortBy={sortBy}
        filteredTotal={total}
        onFilterChange={pushFilter}
        onSortChange={pushSort}
      />

      {leads.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-sm" style={{ color: '#3D4558' }}>
            No leads match the selected filter.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {leads.map((lead, i) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              page={page}
              limit={limit}
              index={i}
            />
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
