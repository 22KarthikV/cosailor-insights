import { getLead } from '@/lib/api';
import { ScoreRing } from '@/components/ScoreRing';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from_page?: string; from_limit?: string }>;
}

function SectionCard({
  title,
  accent,
  children,
}: {
  title: string;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl p-5 animate-slide-up"
      style={{
        background: '#0F1117',
        border: '1px solid #1C2333',
        borderLeft: accent ? `3px solid ${accent}` : '1px solid #1C2333',
      }}
    >
      <h2
        className="text-xs font-mono uppercase tracking-widest mb-3"
        style={{ color: '#3D4558' }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

function ScorePanel({
  leadScore,
  convertibilityScore,
  scoreRationale,
  convertibilityRationale,
  certifications,
  rating,
  reviewCount,
  status,
  enrichedAt,
}: {
  leadScore: number | null;
  convertibilityScore: number | null;
  scoreRationale: string | null;
  convertibilityRationale: string | null;
  certifications: string[];
  rating: number | null;
  reviewCount: number | null;
  status: string;
  enrichedAt: string | null;
}) {
  const statusColor =
    status === 'enriched' ? '#00E87A' : status === 'failed' ? '#FF4757' : '#7A8499';

  return (
    <div
      className="rounded-xl p-5 space-y-5 animate-slide-up"
      style={{
        background: '#0F1117',
        border: '1px solid #1C2333',
        animationDelay: '80ms',
      }}
    >
      {/* Dual score rings */}
      <div className="flex items-start gap-5">
        {[
          { label: 'Lead Score', score: leadScore, rationale: scoreRationale },
          { label: 'Convertibility', score: convertibilityScore, rationale: convertibilityRationale },
        ].map(({ label, score, rationale }) => (
          <div key={label} className="flex flex-col items-center gap-2 flex-1">
            <span className="text-xs font-mono uppercase tracking-widest" style={{ color: '#3D4558' }}>
              {label}
            </span>
            <ScoreRing score={score} size="md" />
            {rationale && (
              <p className="text-xs text-center leading-snug" style={{ color: '#7A8499' }}>
                {rationale}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: '#1C2333' }} />

      {/* Certifications */}
      {certifications.length > 0 && (
        <div>
          <p className="text-xs font-mono uppercase tracking-widest mb-2" style={{ color: '#3D4558' }}>
            Certifications
          </p>
          <div className="flex flex-col gap-1.5">
            {certifications.map((cert) => (
              <span
                key={cert}
                className="text-xs px-2.5 py-1 rounded"
                style={{
                  background: '#161B22',
                  color: '#00C8FF',
                  border: '1px solid rgba(0,200,255,0.15)',
                }}
              >
                {cert}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Rating */}
      {rating !== null && (
        <div>
          <p className="text-xs font-mono uppercase tracking-widest mb-1" style={{ color: '#3D4558' }}>
            Rating
          </p>
          <div className="flex items-center gap-2">
            <span style={{ color: '#FFB020' }}>{'★'.repeat(Math.floor(rating))}</span>
            <span className="text-sm font-mono font-semibold" style={{ color: '#E8ECF4' }}>
              {rating.toFixed(1)}
            </span>
            {reviewCount !== null && (
              <span className="text-xs" style={{ color: '#7A8499' }}>
                ({reviewCount})
              </span>
            )}
          </div>
        </div>
      )}

      {/* Status + timestamp */}
      <div style={{ borderTop: '1px solid #1C2333', paddingTop: '12px' }}>
        <div className="flex items-center justify-between">
          <span
            className="text-xs font-mono px-2 py-0.5 rounded-full capitalize"
            style={{
              color: statusColor,
              background: `${statusColor}15`,
              border: `1px solid ${statusColor}30`,
            }}
          >
            {status}
          </span>
          {enrichedAt && (
            <span className="text-xs font-mono" style={{ color: '#3D4558' }}>
              {new Date(enrichedAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default async function LeadDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { from_page, from_limit } = await searchParams;
  const lead = await getLead(id).catch(() => notFound());

  const backParams = new URLSearchParams();
  if (from_page) backParams.set('page', from_page);
  if (from_limit) backParams.set('limit', from_limit);
  const backHref = `/${backParams.toString() ? `?${backParams.toString()}` : ''}`;

  const location = [lead.city, lead.state].filter(Boolean).join(', ');

  return (
    <div className="min-h-screen" style={{ background: '#08090C' }}>
      {/* Sticky back nav */}
      <div
        className="sticky top-0 z-10 px-6 py-3"
        style={{
          background: 'rgba(8,9,12,0.85)',
          borderBottom: '1px solid #1C2333',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <div className="max-w-6xl mx-auto">
          <Link
            href={backHref}
            className="back-link inline-flex items-center gap-2 text-sm transition-colors duration-150"
          >
            ← Back to dashboard
          </Link>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Error banner */}
        {lead.status === 'failed' && (
          <div
            className="mb-6 px-4 py-3 rounded-xl text-sm"
            style={{
              background: 'rgba(255,71,87,0.08)',
              border: '1px solid rgba(255,71,87,0.25)',
              color: '#FF4757',
            }}
          >
            <p className="font-semibold">Enrichment failed</p>
            {lead.error_message && (
              <p className="mt-1 text-xs opacity-80">{lead.error_message}</p>
            )}
          </div>
        )}

        {/* Company header */}
        <div className="mb-8 animate-slide-up">
          <h1
            className="text-3xl sm:text-4xl font-heading font-bold tracking-tight"
            style={{ color: '#E8ECF4' }}
          >
            {lead.company_name}
          </h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {location && (
              <span className="text-sm" style={{ color: '#7A8499' }}>{location}</span>
            )}
            {lead.phone && (
              <span className="text-sm font-mono" style={{ color: '#7A8499' }}>{lead.phone}</span>
            )}
            {lead.website && (
              <a
                href={lead.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm transition-colors duration-150"
                style={{ color: '#00C8FF' }}
              >
                {lead.website.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        </div>

        {/* Two-column layout: content left, score panel right */}
        <div className="flex flex-col lg:grid lg:grid-cols-[1fr_300px] gap-6">
          {/* Left: content sections */}
          <div className="space-y-4 min-w-0 order-2 lg:order-1">
            {/* AI Summary */}
            {lead.ai_summary && (
              <SectionCard title="Sales Summary" accent="#00C8FF">
                <div
                  className="text-sm leading-relaxed prose prose-sm max-w-none"
                  style={{ color: '#E8ECF4' }}
                >
                  <ReactMarkdown>{lead.ai_summary}</ReactMarkdown>
                </div>
              </SectionCard>
            )}

            {/* Talking Points */}
            {lead.talking_points.length > 0 && (
              <SectionCard title="Talking Points" accent="#FFB020">
                <ol className="space-y-3">
                  {lead.talking_points.map((point, i) => (
                    <li
                      key={i}
                      className="flex gap-3 text-sm group"
                    >
                      <span
                        className="font-mono font-bold shrink-0 w-5 text-right"
                        style={{ color: '#FFB020' }}
                      >
                        {i + 1}.
                      </span>
                      <span style={{ color: '#E8ECF4' }}>{point}</span>
                    </li>
                  ))}
                </ol>
              </SectionCard>
            )}

            {/* Recommended Approach */}
            {lead.recommended_approach && (
              <SectionCard title="Recommended Approach" accent="#00E87A">
                <div
                  className="text-sm leading-relaxed prose prose-sm max-w-none"
                  style={{ color: '#E8ECF4' }}
                >
                  <ReactMarkdown>{lead.recommended_approach}</ReactMarkdown>
                </div>
              </SectionCard>
            )}

            {/* Opportunity Signals */}
            {(lead.distance_band !== null || lead.priority_index !== null) && (
              <SectionCard title="Opportunity Signals">
                <div className="flex flex-wrap gap-4">
                  {lead.distance_band !== null && (
                    <div
                      className="px-4 py-3 rounded-lg"
                      style={{ background: '#161B22', border: '1px solid #2D3748' }}
                    >
                      <p className="text-xs font-mono uppercase tracking-widest mb-1" style={{ color: '#3D4558' }}>
                        Distance
                      </p>
                      <p className="font-heading font-bold capitalize" style={{ color: '#E8ECF4' }}>
                        {lead.distance_band}
                      </p>
                      {lead.distance_miles !== null && (
                        <p className="text-xs font-mono mt-0.5" style={{ color: '#7A8499' }}>
                          {lead.distance_miles.toFixed(1)} mi away
                        </p>
                      )}
                    </div>
                  )}
                  {lead.priority_index !== null && (
                    <div
                      className="px-4 py-3 rounded-lg"
                      style={{ background: '#161B22', border: '1px solid #2D3748' }}
                    >
                      <p className="text-xs font-mono uppercase tracking-widest mb-1" style={{ color: '#3D4558' }}>
                        Priority Index
                      </p>
                      <p className="font-heading font-bold font-mono" style={{ color: '#00C8FF' }}>
                        {lead.priority_index.toFixed(2)}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: '#7A8499' }}>
                        composite rank
                      </p>
                    </div>
                  )}
                </div>
              </SectionCard>
            )}

            {/* Web Research (collapsible feel via details/summary) */}
            {lead.research_summary && (
              <details
                className="rounded-xl overflow-hidden"
                style={{ background: '#0F1117', border: '1px solid #1C2333' }}
              >
                <summary
                  className="px-5 py-4 cursor-pointer text-xs font-mono uppercase tracking-widest select-none"
                  style={{ color: '#3D4558', listStyle: 'none' }}
                >
                  <span>▸ Web Research (Perplexity)</span>
                </summary>
                <div
                  className="px-5 pb-5 text-xs leading-relaxed prose prose-sm max-w-none"
                  style={{ color: '#7A8499' }}
                >
                  <ReactMarkdown>{lead.research_summary}</ReactMarkdown>
                </div>
              </details>
            )}
          </div>

          {/* Right: sticky score panel */}
          <div className="order-1 lg:order-2">
            <div className="lg:sticky lg:top-20">
              <ScorePanel
                leadScore={lead.lead_score}
                convertibilityScore={lead.convertibility_score}
                scoreRationale={lead.score_rationale}
                convertibilityRationale={lead.convertibility_rationale}
                certifications={lead.certifications}
                rating={lead.rating}
                reviewCount={lead.review_count}
                status={lead.status}
                enrichedAt={lead.enriched_at}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
