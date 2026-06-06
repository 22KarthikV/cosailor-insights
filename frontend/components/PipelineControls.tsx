'use client';

/**
 * PipelineControls — form for triggering a pipeline run and tracking progress.
 *
 * Resilience features:
 *   - On mount, calls GET /api/pipeline/latest to restore the last run's state.
 *     If it was 'running', polling resumes automatically. If 'failed', a Retry
 *     button appears pre-filled with the original params.
 *   - run_id is persisted to localStorage so a hard page refresh reconnects to
 *     an in-progress run without losing the polling state.
 *   - On server restart, the lifespan hook marks orphaned 'running' runs as
 *     'failed' with a clear "interrupted" message — the UI surfaces this and
 *     offers a one-click retry.
 */
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { triggerPipeline, getPipelineStatus, getLatestPipelineRun } from '@/lib/api';
import { revalidateLeads } from '@/app/actions';
import type { PipelineStatusResponse } from '@/lib/types';

const DISTANCE_OPTIONS = [25, 50, 100] as const;
type DistanceOption = (typeof DISTANCE_OPTIONS)[number];

const DEFAULT_POSTAL_CODE = '10013';
const DEFAULT_DISTANCE: DistanceOption = 25;
const DEFAULT_COUNTRY_CODE = 'us' as const;
const US_ZIP_REGEX = /^\d{5}(-\d{4})?$/;
const LS_KEY = 'cosailor_pipeline_run_id';

const INTERRUPTED_PREFIX = 'Server restarted';

function isInterrupted(status: PipelineStatusResponse): boolean {
  return (
    status.status === 'failed' &&
    (status.error_message?.startsWith(INTERRUPTED_PREFIX) ?? false)
  );
}

export function PipelineControls(): React.JSX.Element {
  const isMounted = useRef(true);
  useEffect(() => () => { isMounted.current = false; }, []);

  const router = useRouter();
  const [runId, setRunId] = useState<string | null>(null);
  const [pipeStatus, setPipeStatus] = useState<PipelineStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [postalCode, setPostalCode] = useState<string>(DEFAULT_POSTAL_CODE);
  const [distance, setDistance] = useState<DistanceOption>(DEFAULT_DISTANCE);

  const isRunning = pipeStatus?.status === 'running';
  const isValidPostalCode = US_ZIP_REGEX.test(postalCode.trim());
  const isSubmitDisabled = loading || isRunning || postalCode.trim() === '' || !isValidPostalCode;

  // On mount: restore last run from the backend so state survives page refreshes.
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      try {
        const latest = await getLatestPipelineRun();
        if (cancelled || !isMounted.current) return;

        // Pre-fill form with the params from the last run
        if (DISTANCE_OPTIONS.includes(latest.distance as DistanceOption)) {
          setDistance(latest.distance as DistanceOption);
        }
        if (latest.postal_code) setPostalCode(latest.postal_code);

        if (latest.status === 'running') {
          // Re-attach to an in-progress run — polling useEffect will start automatically
          setRunId(latest.run_id);
          setPipeStatus(latest);
          localStorage.setItem(LS_KEY, latest.run_id);
        } else if (latest.status === 'failed' || latest.status === 'completed') {
          // Show the last terminal status so the user can see what happened
          setPipeStatus(latest);
        }
      } catch {
        // No runs yet or backend down — start fresh
      }
    }

    restore();
    return () => { cancelled = true; };
  }, []);

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    try {
      await revalidateLeads();
      const data = await triggerPipeline(postalCode.trim(), DEFAULT_COUNTRY_CODE, distance, 'playwright');
      localStorage.setItem(LS_KEY, data.run_id);
      setRunId(data.run_id);
      setPipeStatus({
        run_id: data.run_id,
        status: 'running',
        leads_scraped: 0,
        leads_enriched: 0,
        started_at: new Date().toISOString(),
        finished_at: null,
        error_message: null,
        postal_code: postalCode.trim(),
        country_code: DEFAULT_COUNTRY_CODE,
        distance,
      });
    } catch {
      setError('Failed to start pipeline. Is the backend running on port 8000?');
    } finally {
      setLoading(false);
    }
  };

  // Poll every 3 s while a run is active.
  useEffect(() => {
    if (!runId || !isRunning) return;

    const interval = setInterval(async () => {
      try {
        const status = await getPipelineStatus(runId);
        if (!isMounted.current) return;
        setPipeStatus(status);
        await revalidateLeads();
        const onFirstPage =
          !window.location.search ||
          !window.location.search.includes('page=') ||
          window.location.search.includes('page=1');
        if (onFirstPage) router.refresh();
        if (status.status === 'completed' || status.status === 'failed') {
          clearInterval(interval);
          localStorage.removeItem(LS_KEY);
        }
      } catch {
        // Transient network error — keep polling
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [runId, isRunning, router]);

  const interrupted = pipeStatus ? isInterrupted(pipeStatus) : false;

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
          ) : interrupted ? (
            '↺ Retry Pipeline'
          ) : (
            '⚡ Run Pipeline'
          )}
        </Button>
      </div>

      {pipeStatus && (
        <div className="text-sm max-w-xs">
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
            <span
              className={interrupted ? 'text-amber-600' : 'text-red-600'}
              title={pipeStatus.error_message ?? undefined}
            >
              {interrupted
                ? '⚠ Pipeline interrupted by server restart — click Retry Pipeline to resume'
                : `✗ Pipeline failed${pipeStatus.error_message ? `: ${pipeStatus.error_message.slice(0, 120)}` : ''}`}
            </span>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
