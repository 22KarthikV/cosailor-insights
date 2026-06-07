'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { triggerPipeline, getPipelineStatus, getLatestPipelineRun } from '@/lib/api';
import { revalidateLeads } from '@/app/actions';
import type { PipelineStatusResponse } from '@/lib/types';
import { PipelineMissionModal } from '@/components/PipelineMissionModal';

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
  const [showModal, setShowModal] = useState(false);

  const isRunning = pipeStatus?.status === 'running';
  const isValidPostalCode = US_ZIP_REGEX.test(postalCode.trim());
  const isSubmitDisabled = loading || isRunning || postalCode.trim() === '' || !isValidPostalCode;

  // Auto-open mission modal when pipeline starts running
  useEffect(() => {
    if (isRunning) setShowModal(true);
  }, [isRunning]);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      try {
        const latest = await getLatestPipelineRun();
        if (cancelled || !isMounted.current) return;
        if (DISTANCE_OPTIONS.includes(latest.distance as DistanceOption)) {
          setDistance(latest.distance as DistanceOption);
        }
        if (latest.postal_code) setPostalCode(latest.postal_code);
        if (latest.status === 'running') {
          setRunId(latest.run_id);
          setPipeStatus(latest);
          localStorage.setItem(LS_KEY, latest.run_id);
        } else if (latest.status === 'failed' || latest.status === 'completed') {
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

  const enrichedPct =
    pipeStatus && pipeStatus.leads_scraped > 0
      ? Math.min(100, (pipeStatus.leads_enriched / pipeStatus.leads_scraped) * 100)
      : 0;

  const inputStyle: React.CSSProperties = {
    background: '#0F1117',
    border: '1px solid #1C2333',
    color: '#E8ECF4',
    borderRadius: '0.5rem',
    padding: '6px 12px',
    fontSize: '13px',
    outline: 'none',
    transition: 'border-color 0.15s ease',
    opacity: isRunning || loading ? 0.5 : 1,
    cursor: isRunning || loading ? 'not-allowed' : 'text',
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: isRunning || loading ? 'not-allowed' : 'pointer',
    appearance: 'none' as const,
    paddingRight: '28px',
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Controls row */}
      <div className="flex items-end gap-3 flex-wrap">
        {/* ZIP Code */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="pipeline-postal-code"
            className="text-xs font-medium uppercase tracking-widest"
            style={{ color: '#3D4558' }}
          >
            ZIP Code
          </label>
          <input
            id="pipeline-postal-code"
            type="text"
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
            disabled={isRunning || loading}
            placeholder="10013"
            style={{ ...inputStyle, width: '100px' }}
            onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = '#00C8FF'; }}
            onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = '#1C2333'; }}
          />
        </div>

        {/* Distance */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="pipeline-distance"
            className="text-xs font-medium uppercase tracking-widest"
            style={{ color: '#3D4558' }}
          >
            Distance
          </label>
          <div className="relative">
            <select
              id="pipeline-distance"
              value={distance}
              onChange={(e) => setDistance(Number(e.target.value) as DistanceOption)}
              disabled={isRunning || loading}
              style={{ ...selectStyle, width: '110px' }}
            >
              {DISTANCE_OPTIONS.map((miles) => (
                <option key={miles} value={miles}>{miles} miles</option>
              ))}
            </select>
            <span
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs"
              style={{ color: '#3D4558' }}
            >
              ▾
            </span>
          </div>
        </div>

        {/* Run button */}
        <button
          type="button"
          onClick={handleRun}
          disabled={isSubmitDisabled}
          className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all duration-150"
          style={{
            background: isSubmitDisabled ? '#0F1117' : '#00C8FF',
            color: isSubmitDisabled ? '#3D4558' : '#08090C',
            border: `1px solid ${isSubmitDisabled ? '#1C2333' : '#00C8FF'}`,
            cursor: isSubmitDisabled ? 'not-allowed' : 'pointer',
            boxShadow: isSubmitDisabled ? 'none' : '0 0 16px rgba(0,200,255,0.2)',
          }}
        >
          {isRunning ? (
            <>
              <span className="pipeline-pulse inline-block">◈</span>
              Running…
            </>
          ) : interrupted ? (
            <><span>↺</span> Retry</>
          ) : (
            <><span>⚡</span> Run Pipeline</>
          )}
        </button>

        {/* Status chips */}
        {pipeStatus && (
          <div className="flex items-center gap-2 flex-wrap">
            {pipeStatus.status === 'running' && (
              <>
                <span
                  className="text-xs font-mono px-2.5 py-1 rounded-full"
                  style={{ background: 'rgba(0,200,255,0.08)', color: '#00C8FF', border: '1px solid rgba(0,200,255,0.2)' }}
                >
                  ↑ {pipeStatus.leads_scraped} scraped
                </span>
                <span
                  className="text-xs font-mono px-2.5 py-1 rounded-full"
                  style={{ background: 'rgba(0,232,122,0.08)', color: '#00E87A', border: '1px solid rgba(0,232,122,0.2)' }}
                >
                  ✓ {pipeStatus.leads_enriched} enriched
                </span>
                {!showModal && (
                  <button
                    type="button"
                    onClick={() => setShowModal(true)}
                    className="text-xs font-mono px-2.5 py-1 rounded-full transition-all duration-150"
                    style={{
                      background: 'rgba(0,200,255,0.06)',
                      color: '#00C8FF',
                      border: '1px solid rgba(0,200,255,0.2)',
                      cursor: 'pointer',
                    }}
                  >
                    ◈ View Mission
                  </button>
                )}
              </>
            )}
            {pipeStatus.status === 'completed' && (
              <span
                className="text-xs font-mono px-2.5 py-1 rounded-full"
                style={{ background: 'rgba(0,232,122,0.08)', color: '#00E87A', border: '1px solid rgba(0,232,122,0.2)' }}
              >
                ✓ {pipeStatus.leads_enriched} leads enriched
              </span>
            )}
            {pipeStatus.status === 'failed' && (
              <span
                className="text-xs font-mono px-2.5 py-1 rounded-full"
                style={{
                  background: interrupted ? 'rgba(255,176,32,0.08)' : 'rgba(255,71,87,0.08)',
                  color: interrupted ? '#FFB020' : '#FF4757',
                  border: `1px solid ${interrupted ? 'rgba(255,176,32,0.2)' : 'rgba(255,71,87,0.2)'}`,
                }}
                title={pipeStatus.error_message ?? undefined}
              >
                {interrupted ? '⚠ Interrupted — retry' : '✗ Failed'}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ZIP validation error */}
      {postalCode.length > 0 && !isValidPostalCode && (
        <p className="text-xs" style={{ color: '#FF4757' }}>
          Enter a valid US ZIP code
        </p>
      )}

      {/* Generic error */}
      {error && <p className="text-xs" style={{ color: '#FF4757' }}>{error}</p>}

      {/* Progress bar — shown while running */}
      {isRunning && (
        <div
          className="h-0.5 rounded-full overflow-hidden"
          style={{ background: '#1C2333' }}
        >
          <div
            className="h-full rounded-full bar-fill transition-all duration-700 ease-out"
            style={{
              width: `${enrichedPct || 8}%`,
              background: 'linear-gradient(90deg, #00C8FF, #00E87A)',
            }}
          />
        </div>
      )}

      {/* Mission Terminal modal */}
      {showModal && (
        <PipelineMissionModal
          pipeStatus={pipeStatus}
          postalCode={postalCode}
          distance={distance}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
