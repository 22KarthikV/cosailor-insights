import { getLead } from '@/lib/api';
import { ScoreBadge } from '@/components/ScoreBadge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { notFound } from 'next/navigation';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function LeadDetailPage({ params }: Props) {
  const { id } = await params;
  let lead;
  try {
    lead = await getLead(id);
  } catch {
    notFound();
  }

  const location = [lead.city, lead.state].filter(Boolean).join(', ');

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/" className="text-sm text-blue-600 hover:underline mb-6 inline-block">
        &larr; Back to Dashboard
      </Link>

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
        <ScoreBadge score={lead.lead_score} size="lg" />
      </div>

      {lead.certifications.length > 0 && (
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
        {lead.ai_summary && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Sales Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-700 leading-relaxed">{lead.ai_summary}</p>
              {lead.score_rationale && (
                <p className="text-xs text-gray-500 mt-2 italic">{lead.score_rationale}</p>
              )}
            </CardContent>
          </Card>
        )}

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

        {lead.recommended_approach && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Recommended Approach</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-700 leading-relaxed">{lead.recommended_approach}</p>
            </CardContent>
          </Card>
        )}

        {lead.research_summary && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-gray-400">
                Web Research (Perplexity)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-gray-500 leading-relaxed whitespace-pre-line">
                {lead.research_summary}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
