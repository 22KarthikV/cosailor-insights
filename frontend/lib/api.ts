/**
 * HTTP client functions for the Cosailor Insights backend API.
 *
 * All functions are thin wrappers around fetch() that throw on non-2xx
 * responses. They are intentionally stateless — no caching layer is added
 * here; Next.js cache: 'no-store' ensures fresh data on every server render.
 */
import type { Lead, PipelineRunResponse, PipelineStatusResponse } from './types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

/** Fetch all leads ordered by priority_index descending. */
export async function getLeads(): Promise<Lead[]> {
  const res = await fetch(`${API_BASE}/api/leads/`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch leads: ${res.status}`);
  return res.json();
}

/** Fetch a single lead by UUID. Throws when not found (404). */
export async function getLead(id: string): Promise<Lead> {
  const res = await fetch(`${API_BASE}/api/leads/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Lead not found: ${res.status}`);
  return res.json();
}

/**
 * Start a new pipeline run and return the 202 response with a run_id.
 * The pipeline executes as a backend BackgroundTask; poll getPipelineStatus()
 * to track progress.
 */
export async function triggerPipeline(
  postalCode: string = '10013',
  countryCode: string = 'us',
  distance: number = 25
): Promise<PipelineRunResponse> {
  const res = await fetch(`${API_BASE}/api/pipeline/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postal_code: postalCode, country_code: countryCode, distance }),
  });
  if (!res.ok) throw new Error(`Failed to start pipeline: ${res.status}`);
  return res.json();
}

/** Poll the current state of a pipeline run. Used every 3 s by PipelineControls. */
export async function getPipelineStatus(runId: string): Promise<PipelineStatusResponse> {
  const res = await fetch(`${API_BASE}/api/pipeline/status/${runId}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Pipeline run not found: ${res.status}`);
  return res.json();
}
