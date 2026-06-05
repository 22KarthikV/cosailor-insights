'use client';

/**
 * PipelineControls — form for triggering a pipeline run and tracking progress.
 *
 * Polls GET /api/pipeline/status/:run_id every 3 seconds while a run is active.
 * On every successful poll, calls revalidateLeads() (server action) then
 * router.refresh() so the Server Component re-fetches fresh leads from the DB.
 * This means partial cards appear as soon as scraping writes leads to the DB,
 * and score badges fill in progressively as each enrichment completes.
 */
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { triggerPipeline, getPipelineStatus } from '@/lib/api';
import { revalidateLeads } from '@/app/actions';
import type { PipelineStatusResponse } from '@/lib/types';

const DISTANCE_OPTIONS = [25, 50, 100] as const;
type DistanceOption = (typeof DISTANCE_OPTIONS)[number];

const DEFAULT_COUNTRY_CODE = 'us' as const;
const US_ZIP_REGEX = /^\d{5}(-\d{4})?$/;

export function PipelineControls(): React.JSX.Element {
  const router = useRouter();
  const [runId, setRunId] = useState<string | null>(null);
  const [pipeStatus, setPipeStatus] = useState<PipelineStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [postalCode, setPostalCode] = useState<string>('10013');
  const [distance, setDistance] = useState<DistanceOption>(25);

  const isRunning = pipeStatus?.status === 'running';
  const isValidPostalCode = US_ZIP_REGEX.test(postalCode.trim());
  const isSubmitDisabled = loading || isRunning || postalCode.trim() === '' || !isValidPostalCode;

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    try {
      // Bust cache so the first refresh after scraping shows fresh data
      await revalidateLeads();
      const data = await triggerPipeline(postalCode.trim(), DEFAULT_COUNTRY_CODE, distance, 'playwright');
      setRunId(data.run_id);
      setPipeStatus({
        run_id: data.run_id,
        status: 'running',
        leads_scraped: 0,
        leads_enriched: 0,
        started_at: new Date().toISOString(),
        finished_at: null,
        error_message: null,
      });
    } catch {
      setError('Failed to start pipeline. Is the backend running on port 8000?');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Poll every 3 seconds while a run is active.
   * Each tick: revalidate cache, then refresh the Server Component so
   * partial cards appear progressively as leads are scraped and enriched.
   */
  useEffect(() => {
    if (!runId || !isRunning) return;

    const interval = setInterval(async () => {
      try {
        const status = await getPipelineStatus(runId);
        setPipeStatus(status);
        // Always revalidate + refresh — shows partial cards during scraping
        // and progressively filled cards during enrichment.
        await revalidateLeads();
        router.refresh();
        if (status.status === 'completed' || status.status === 'failed') {
          clearInterval(interval);
        }
      } catch {
        /* keep polling — transient network errors should not cancel the interval */
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [runId, isRunning, router]);

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <div className="flex flex-col gap-1">
        <label htmlFor="pipeline-postal-code" className="text-xs font-medium text-gray-600">
          ZIP Code
        </label>
        <input
          id="pipeline-postal-code"
          type="text"
          value={postalCode}
          onChange={(e) => setPostalCode(e.target.value)}
          disabled={isRunning || loading}
          placeholder="e.g. 10013"
          className="h-9 w-28 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        />
        {postalCode.length > 0 && !isValidPostalCode && (
          <p className="text-xs text-red-500 mt-1">Enter a valid US ZIP code</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="pipeline-distance" className="text-xs font-medium text-gray-600">
          Distance
        </label>
        <select
          id="pipeline-distance"
          value={distance}
          onChange={(e) => setDistance(Number(e.target.value) as DistanceOption)}
          disabled={isRunning || loading}
          className="h-9 w-28 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {DISTANCE_OPTIONS.map((miles) => (
            <option key={miles} value={miles}>
              {miles} miles
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col justify-end gap-1">
        <span className="text-xs font-medium text-transparent select-none" aria-hidden="true">
          &nbsp;
        </span>
        <Button
          onClick={handleRun}
          disabled={isSubmitDisabled}
          className="bg-blue-600 hover:bg-blue-700"
        >
          {isRunning ? (
            <>
              <span className="animate-spin mr-2 inline-block">&#x27F3;</span>
              Running Pipeline...
            </>
          ) : (
            '⚡ Run Pipeline'
          )}
        </Button>
      </div>

      {pipeStatus && (
        <div className="text-sm">
          {pipeStatus.status === 'running' && (
            <span className="text-gray-600">
              Scraped {pipeStatus.leads_scraped} &middot; Enriched {pipeStatus.leads_enriched}
            </span>
          )}
          {pipeStatus.status === 'completed' && (
            <span className="text-green-600 font-medium">
              &#x2713; {pipeStatus.leads_enriched} leads enriched
            </span>
          )}
          {pipeStatus.status === 'failed' && (
            <span className="text-red-600">&#x2717; Pipeline failed</span>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
