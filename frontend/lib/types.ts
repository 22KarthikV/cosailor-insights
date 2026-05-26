export interface Lead {
  id: string;
  company_name: string;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country_code: string;
  phone: string | null;
  website: string | null;
  certifications: string[];
  rating: number | null;
  review_count: number | null;
  research_summary: string | null;
  lead_score: number | null;
  score_rationale: string | null;
  convertibility_score: number | null;
  convertibility_rationale: string | null;
  distance_miles: number | null;
  distance_band: 'near' | 'mid' | 'far' | null;
  priority_index: number | null;
  ai_summary: string | null;
  talking_points: string[];
  recommended_approach: string | null;
  status: 'scraped' | 'researched' | 'enriched' | 'failed';
  error_message: string | null;
  enriched_at: string | null;
  created_at: string;
}

export interface PipelineRunResponse {
  run_id: string;
  status: string;
  message: string;
}

export interface PipelineStatusResponse {
  run_id: string;
  status: 'running' | 'completed' | 'failed';
  leads_scraped: number;
  leads_enriched: number;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
}
