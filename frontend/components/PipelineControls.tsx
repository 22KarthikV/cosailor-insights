'use client';

/**
 * PipelineControls — form for triggering a pipeline run and tracking its progress.
 *
 * This is the only component on the dashboard that polls the backend. After a
 * run is started it polls GET /api/pipeline/status/:run_id every 3 seconds until
 * the status reaches 'completed' or 'failed', then calls router.refresh() so the
 * Server Component re-fetches the updated leads list.
 *
 * ZIP code validation uses a regex rather than a library to keep the bundle small;
 * only US 5-digit and ZIP+4 formats are accepted because GAF operates in the US.
 */
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { triggerPipeline, getPipelineStatus } from '@/lib/api';
import type { PipelineStatusResponse } from '@/lib/types';

/** Values the user can select for the search radius. Must match the backend's allowed distances. */
const DISTANCE_OPTIONS = [25, 50, 100] as const;
type DistanceOption = (typeof DISTANCE_OPTIONS)[number];

const DEFAULT_COUNTRY_CODE = 'us' as const;
/** Accepts standard 5-digit ZIPs and ZIP+4 (e.g. 10013-1234). */
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

  /** Trigger a new pipeline run and optimistically set status to 'running'. */
  const handleRun = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await triggerPipeline(postalCode.trim(), DEFAULT_COUNTRY_CODE, distance);
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
   * Poll the pipeline status every 3 seconds while a run is active.
   * Clears the interval and triggers a server-side refresh when the run finishes.
   */
  useEffect(() => {
    if (!runId || !isRunning) return;
    const interval = setInterval(async () => {
      try {
        const status = await getPipelineStatus(runId);
        setPipeStatus(status);
        if (status.status === 'completed' || status.status === 'failed') {
          clearInterval(interval);
          router.refresh();
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
        <label
          htmlFor="pipeline-postal-code"
          className="text-xs font-medium text-gray-600"
        >
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
        <label
          htmlFor="pipeline-distance"
          className="text-xs font-medium text-gray-600"
        >
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

      {/*
        Invisible spacer label keeps the button vertically aligned with the
        labelled inputs above it without any absolute positioning.
      */}
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

      {/* Live progress display shown while a run is active or after it finishes */}
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
