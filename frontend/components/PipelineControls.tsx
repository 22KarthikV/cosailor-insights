'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { triggerPipeline, getPipelineStatus } from '@/lib/api';
import type { PipelineStatusResponse } from '@/lib/types';

const DISTANCE_OPTIONS = [25, 50, 100] as const;
type DistanceOption = (typeof DISTANCE_OPTIONS)[number];

export function PipelineControls() {
  const router = useRouter();
  const [runId, setRunId] = useState<string | null>(null);
  const [pipeStatus, setPipeStatus] = useState<PipelineStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [postalCode, setPostalCode] = useState<string>('10013');
  const [distance, setDistance] = useState<DistanceOption>(25);

  const isRunning = pipeStatus?.status === 'running';
  const isSubmitDisabled = loading || isRunning || postalCode.trim() === '';

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await triggerPipeline(postalCode.trim(), 'us', distance);
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
        /* keep polling */
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
