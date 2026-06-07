import Link from 'next/link';
import { ScoreRing } from './ScoreRing';
import type { Lead } from '@/lib/types';

interface LeadCardProps {
  lead: Lead;
  page?: number;
  limit?: number;
  index?: number;
}

function getPriorityColor(score: number | null): string {
  if (score === null) return '#1C2333';
  if (score >= 8) return '#00E87A';
  if (score >= 5) return '#FFB020';
  return '#FF4757';
}

function getPriorityGlow(score: number | null): string {
  if (score === null) return 'transparent';
  if (score >= 8) return 'rgba(0,232,122,0.12)';
  if (score >= 5) return 'rgba(255,176,32,0.12)';
  return 'rgba(255,71,87,0.12)';
}

type DistanceBand = 'near' | 'mid' | 'far' | null;

function getDistanceMeta(band: DistanceBand): { color: string; bg: string; label: string } {
  if (band === 'near') return { color: '#00E87A', bg: 'rgba(0,232,122,0.08)', label: 'Near' };
  if (band === 'mid')  return { color: '#FFB020', bg: 'rgba(255,176,32,0.08)', label: 'Mid' };
  if (band === 'far')  return { color: '#7A8499', bg: 'rgba(122,132,153,0.08)', label: 'Far' };
  return { color: '#7A8499', bg: 'transparent', label: '' };
}

function renderStars(rating: number): string {
  const full = Math.min(5, Math.floor(rating));
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

export function LeadCard({ lead, page, limit, index = 0 }: LeadCardProps) {
  const location = [lead.city, lead.state].filter(Boolean).join(', ');

  const params = new URLSearchParams();
  if (page && page > 1) params.set('from_page', String(page));
  if (limit) params.set('from_limit', String(limit));
  const qs = params.toString();
  const href = `/leads/${lead.id}${qs ? `?${qs}` : ''}`;

  const priorityColor = getPriorityColor(lead.lead_score);
  const priorityGlow = getPriorityGlow(lead.lead_score);
  const dist = getDistanceMeta(lead.distance_band);

  return (
    <Link
      href={href}
      className="block h-full animate-card-enter"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div
        className="lead-card h-full"
        style={
          {
            '--priority-color': priorityColor,
            '--priority-glow': priorityGlow,
          } as React.CSSProperties
        }
      >
        <div className="p-4 h-full flex flex-col gap-3">
          {/* Row 1: company name + score ring */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3
                className="font-semibold text-sm leading-tight truncate"
                style={{
                  color: '#E8ECF4',
                  fontFamily: 'var(--font-syne, sans-serif)',
                  fontWeight: 600,
                }}
              >
                {lead.company_name}
              </h3>

              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {location && (
                  <span className="text-xs" style={{ color: '#7A8499' }}>
                    {location}
                  </span>
                )}
                {dist.label && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                    style={{ color: dist.color, background: dist.bg }}
                  >
                    {dist.label}
                  </span>
                )}
              </div>
            </div>

            <ScoreRing score={lead.lead_score} size="sm" />
          </div>

          {/* Row 2: certifications */}
          {lead.certifications.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {lead.certifications.slice(0, 2).map((cert) => (
                <span
                  key={cert}
                  className="text-xs px-2 py-0.5 rounded truncate max-w-[144px]"
                  style={{
                    background: '#161B22',
                    color: '#7A8499',
                    border: '1px solid #2D3748',
                  }}
                  title={cert}
                >
                  {cert}
                </span>
              ))}
              {lead.certifications.length > 2 && (
                <span
                  className="text-xs px-2 py-0.5 rounded shrink-0"
                  style={{
                    background: '#161B22',
                    color: '#7A8499',
                    border: '1px solid #2D3748',
                  }}
                >
                  +{lead.certifications.length - 2}
                </span>
              )}
            </div>
          )}

          {/* Row 3: AI summary excerpt */}
          {lead.ai_summary && (
            <p
              className="text-xs leading-relaxed line-clamp-2 flex-1"
              style={{ color: '#7A8499' }}
            >
              {lead.ai_summary}
            </p>
          )}

          {/* Row 4: rating + failure badge */}
          <div className="flex items-center justify-between mt-auto pt-1">
            {lead.rating !== null ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs tracking-tight" style={{ color: '#FFB020' }}>
                  {renderStars(lead.rating)}
                </span>
                <span className="text-xs font-mono" style={{ color: '#7A8499' }}>
                  {lead.rating.toFixed(1)}
                  {lead.review_count !== null && (
                    <span> ({lead.review_count})</span>
                  )}
                </span>
              </div>
            ) : (
              <span />
            )}

            {lead.status === 'failed' && (
              <span className="text-xs font-medium" style={{ color: '#FF4757' }}>
                ⚠ Failed
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
