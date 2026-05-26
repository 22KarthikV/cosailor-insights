import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScoreBadge } from './ScoreBadge';
import type { Lead } from '@/lib/types';

export function LeadCard({ lead }: { lead: Lead }) {
  const location = [lead.city, lead.state].filter(Boolean).join(', ');
  return (
    <Link href={`/leads/${lead.id}`} className="block group">
      <Card className="h-full transition-shadow hover:shadow-md border-gray-200 group-hover:border-blue-300">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-gray-900 text-sm leading-tight truncate">
                {lead.company_name}
              </h3>
              {location && <p className="text-xs text-gray-500 mt-0.5">{location}</p>}
            </div>
            <ScoreBadge score={lead.lead_score} />
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {lead.certifications.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {lead.certifications.map((cert) => (
                <Badge key={cert} variant="secondary" className="text-xs">{cert}</Badge>
              ))}
            </div>
          )}
          {lead.ai_summary && (
            <p className="text-xs text-gray-600 leading-relaxed line-clamp-3">{lead.ai_summary}</p>
          )}
          {lead.rating !== null && (
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <span className="text-yellow-500">★</span>
              <span>{lead.rating.toFixed(1)}</span>
              {lead.review_count !== null && <span>({lead.review_count} reviews)</span>}
            </div>
          )}
          {lead.status === 'failed' && (
            <p className="text-xs text-red-500">⚠ Enrichment failed</p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
