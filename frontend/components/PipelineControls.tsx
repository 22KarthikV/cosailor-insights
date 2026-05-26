'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { triggerPipeline, getPipelineStatus } from '@/lib/api';
import type { PipelineStatusResponse } from '@/lib/types';

export function PipelineControls() {
  const router = useRouter();
  const [runId, setRunId] = useState<string | null>(null);
  const [pipeStatus, setPipeStatus] = useState<PipelineStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRunning = pipeStatus?.status === 'running';

  const handleRun = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await triggerPipeline('10013', 'us', 25);
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
      <Button
        onClick={handleRun}
        disabled={loading || isRunning}
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
