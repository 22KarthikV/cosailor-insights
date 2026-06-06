/**
 * Lead detail page — rendered at /leads/:id.
 *
 * Fetches a single lead server-side and renders a full-page breakdown
 * including dual score badges (lead + convertibility), opportunity signals,
 * AI sales summary, talking points, recommended approach, and raw research.
 *
 * Calls notFound() when the backend returns a non-2xx response, letting
 * Next.js serve its built-in 404 page.
 */
import { getLead } from '@/lib/api';
import { ScoreBadge } from '@/components/ScoreBadge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from_page?: string; from_limit?: string }>;
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
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link href={backHref} className="text-sm text-blue-600 hover:underline mb-6 inline-block">
        &larr; Back to Dashboard
      </Link>

      {/* Error banner — only shown when enrichment failed */}
      {lead.status === 'failed' && (
        <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-semibold">Enrichment failed</p>
          {lead.error_message && (
            <p className="mt-1 text-red-600">{lead.error_message}</p>
          )}
        </div>
      )}

      {/* Header: company info left, dual score column right */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{lead.company_name}</h1>
          {location && <p className="text-gray-500 mt-1">{location}</p>}
          {lead.phone && <p className="text-sm text-gray-500 mt-1">{lead.phone}</p>}
          {lead.website && (
            <a
              href={lead.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline mt-1 block"
            >
              {lead.website}
            </a>
          )}
        </div>

        {/* Compact score chips — badge + mini-bar only; rationale lives in the Score Analysis card below */}
        <div className="flex flex-row items-center gap-5 shrink-0">
          {(
            [
              { label: 'Lead', score: lead.lead_score, ariaLabel: 'Lead score' },
              { label: 'Conv.', score: lead.convertibility_score, ariaLabel: 'Convertibility score' },
            ] as const
          ).map(({ label, score, ariaLabel }) =>
            score !== null ? (
              <div key={label} className="flex flex-col items-center gap-1.5">
                <span className="text-xs text-gray-400 font-medium">{label}</span>
                <ScoreBadge score={score} size="lg" />
                <div className="w-14 bg-gray-200 rounded-full h-1 overflow-hidden">
                  <div
                    className={
                      'h-1 rounded-full ' +
                      (score >= 8 ? 'bg-green-500' : score >= 5 ? 'bg-yellow-500' : 'bg-red-500')
                    }
                    style={{ width: `${(score / 10) * 100}%` }}
                    role="progressbar"
                    aria-valuenow={score}
                    aria-valuemin={0}
                    aria-valuemax={10}
                    aria-label={`${ariaLabel}: ${score} out of 10`}
                  />
                </div>
              </div>
            ) : null
          )}
        </div>
      </div>

      {/* Certifications + rating badges */}
      {(lead.certifications.length > 0 || lead.rating !== null) && (
        <div className="flex flex-wrap gap-2 mb-6">
          {lead.certifications.map((c) => (
            <Badge key={c} variant="secondary">
              {c}
            </Badge>
          ))}
          {lead.rating !== null && (
            <Badge variant="outline">
              &#9733; {lead.rating.toFixed(1)} ({lead.review_count} reviews)
            </Badge>
          )}
        </div>
      )}

      <div className="space-y-4">
        {/* Score Analysis — rationale text lives here, not in the compact header chips */}
        {(lead.score_rationale || lead.convertibility_rationale) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Score Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                {lead.score_rationale && (
                  <div>
                    <dt className="text-xs text-gray-500 uppercase tracking-wide mb-1">Lead Score</dt>
                    <dd className="text-gray-700 leading-snug">{lead.score_rationale}</dd>
                  </div>
                )}
                {lead.convertibility_rationale && (
                  <div>
                    <dt className="text-xs text-gray-500 uppercase tracking-wide mb-1">Convertibility</dt>
                    <dd className="text-gray-700 leading-snug">{lead.convertibility_rationale}</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>
        )}

        {/* Opportunity Signals — distance band + composite priority index */}
        {(lead.distance_band !== null || lead.priority_index !== null) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Opportunity Signals</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                {lead.distance_band !== null && (
                  <div>
                    <dt className="text-xs text-gray-500 uppercase tracking-wide">Distance</dt>
                    <dd className="mt-1 font-semibold capitalize">{lead.distance_band}</dd>
                    {lead.distance_miles !== null && (
                      <dd className="text-xs text-gray-400">
                        {lead.distance_miles.toFixed(1)} mi away
                      </dd>
                    )}
                  </div>
                )}
                {lead.priority_index !== null && (
                  <div>
                    <dt className="text-xs text-gray-500 uppercase tracking-wide">Priority Index</dt>
                    <dd className="mt-1 font-semibold">{lead.priority_index.toFixed(2)}</dd>
                    <dd className="text-xs text-gray-400">composite rank</dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>
        )}

        {/* AI Sales Summary — Claude-generated 2–3 sentence overview */}
        {lead.ai_summary && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Sales Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm prose-gray max-w-none">
                <ReactMarkdown>{lead.ai_summary}</ReactMarkdown>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Talking Points — up to 3 contractor-specific sales hooks */}
        {lead.talking_points.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Talking Points</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {lead.talking_points.map((point, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-700">
                    <span className="text-blue-500 font-bold shrink-0">{i + 1}.</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Recommended Approach — Claude's suggested outreach strategy */}
        {lead.recommended_approach && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Recommended Approach</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm prose-gray max-w-none">
                <ReactMarkdown>{lead.recommended_approach}</ReactMarkdown>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Web Research — raw Perplexity summary stored in Stage 2 */}
        {lead.research_summary && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-gray-400">
                Web Research (Perplexity)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose prose-xs prose-gray max-w-none text-xs leading-relaxed">
                <ReactMarkdown>{lead.research_summary}</ReactMarkdown>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Status / meta footer */}
      <div className="mt-8 pt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
        <span>
          Status:{' '}
          <span
            className={
              'font-medium capitalize ' +
              (lead.status === 'enriched'
                ? 'text-green-600'
                : lead.status === 'failed'
                  ? 'text-red-600'
                  : 'text-gray-500')
            }
          >
            {lead.status}
          </span>
        </span>
        {lead.enriched_at && (
          <span>
            Enriched{' '}
            {new Date(lead.enriched_at).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
      </div>
    </div>
  );
}
