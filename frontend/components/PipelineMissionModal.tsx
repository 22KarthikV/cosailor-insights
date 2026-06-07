'use client';

import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import type { PipelineStatusResponse } from '@/lib/types';

interface Props {
  pipeStatus: PipelineStatusResponse | null;
  postalCode: string;
  distance: number;
  onClose: () => void;
}

interface LogLine {
  id: number;
  timestamp: string;
  text: string;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `[${m}:${s}]`;
}

type StageStatus = 'pending' | 'active' | 'complete';

function getStageColors(status: StageStatus): { node: string; label: string } {
  if (status === 'active')   return { node: '#00C8FF', label: '#00C8FF' };
  if (status === 'complete') return { node: '#00E87A', label: '#00E87A' };
  return { node: '#1C2333', label: '#3D4558' };
}

function StageNode({
  label,
  sublabel,
  status,
  showConnector,
}: {
  label: string;
  sublabel: string;
  status: StageStatus;
  showConnector: boolean;
}) {
  const { node, label: labelColor } = getStageColors(status);
  const nodeClass =
    status === 'active' ? 'node-active' : status === 'complete' ? 'node-complete' : '';

  return (
    <div className="flex flex-col items-center">
      <div
        className={`w-10 h-10 rounded-full flex items-center justify-center text-base font-mono font-bold ${nodeClass}`}
        style={{
          background: status === 'pending' ? '#0F1117' : `${node}18`,
          border: `2px solid ${node}`,
          color: node,
          transition: 'all 0.5s ease',
        }}
      >
        {status === 'complete' ? '✓' : status === 'active' ? '◈' : '○'}
      </div>

      <span
        className="text-xs font-mono uppercase tracking-widest mt-2 font-semibold"
        style={{ color: labelColor, transition: 'color 0.5s ease' }}
      >
        {label}
      </span>
      <span className="text-xs mt-0.5" style={{ color: '#3D4558' }}>
        {sublabel}
      </span>

      {showConnector && (
        <div
          className="relative mt-2 mb-2"
          style={{ width: 2, height: 32, background: '#1C2333', overflow: 'hidden' }}
        >
          {(status === 'active' || status === 'complete') && (
            <div
              className="flow-particle-el"
              style={{ background: node, boxShadow: `0 0 6px ${node}` }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function StatBlock({
  value,
  label,
  color,
  animKey,
}: {
  value: string | number;
  label: string;
  color: string;
  animKey: string | number;
}) {
  return (
    <div
      className="rounded-xl p-4 flex flex-col items-center gap-1"
      style={{ background: '#161B22', border: '1px solid #1C2333' }}
    >
      <span
        key={animKey}
        className="text-3xl font-heading font-bold counter-pop"
        style={{ color }}
      >
        {value}
      </span>
      <span className="text-xs font-mono uppercase tracking-widest" style={{ color: '#3D4558' }}>
        {label}
      </span>
    </div>
  );
}

export function PipelineMissionModal({ pipeStatus, postalCode, distance, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const logIdRef = useRef(0);
  const firedScripts = useRef(new Set<number>());

  // Mount guard — portal requires document.body to exist
  useEffect(() => { setMounted(true); }, []);

  const isRunning = pipeStatus?.status === 'running';
  const isComplete = pipeStatus?.status === 'completed';
  const isFailed = pipeStatus?.status === 'failed';

  const scraped = pipeStatus?.leads_scraped ?? 0;
  const enriched = pipeStatus?.leads_enriched ?? 0;

  // Elapsed timer
  useEffect(() => {
    if (!pipeStatus?.started_at) return;
    const startMs = new Date(pipeStatus.started_at).getTime();
    const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    if (!isRunning) return;
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [pipeStatus?.started_at, isRunning]);

  // Pseudo-log: fire pre-scripted lines as elapsed time advances
  useEffect(() => {
    const scripts: Array<{ at: number; getText: () => string }> = [
      { at: 2,  getText: () => '⬡ Playwright browser initializing...' },
      { at: 5,  getText: () => '⬡ Connecting to GAF contractor directory' },
      { at: 8,  getText: () => `⬡ Search: ${postalCode} · ${distance}mi radius` },
      { at: 15, getText: () => '↑ Scraping commercial listings...' },
      { at: 25, getText: () => scraped > 0 ? `◈ ${scraped} contractor records acquired` : '↑ Scanning contractor profiles...' },
      { at: 35, getText: () => '◈ Queuing Perplexity research...' },
      { at: 50, getText: () => '◈ Web research: batch 1 in progress' },
      { at: 70, getText: () => '⚡ Claude AI enrichment started' },
      { at: 90, getText: () => enriched > 0 ? `✓ ${enriched} leads enriched and scored` : '⚡ Scoring in progress...' },
    ];

    for (const { at, getText } of scripts) {
      if (!firedScripts.current.has(at) && elapsedSeconds >= at) {
        firedScripts.current.add(at);
        const text = getText();
        setLogLines((prev) => [
          ...prev,
          { id: ++logIdRef.current, timestamp: formatTimestamp(at), text },
        ]);
      }
    }
  }, [elapsedSeconds, postalCode, distance, scraped, enriched]);

  // Terminal lines for completion / failure
  useEffect(() => {
    if (isComplete && !firedScripts.current.has(9999)) {
      firedScripts.current.add(9999);
      setLogLines((prev) => [
        ...prev,
        {
          id: ++logIdRef.current,
          timestamp: formatTimestamp(elapsedSeconds),
          text: `✓ Pipeline complete — ${enriched} leads ready`,
        },
      ]);
    }
    if (isFailed && !firedScripts.current.has(9998)) {
      firedScripts.current.add(9998);
      setLogLines((prev) => [
        ...prev,
        {
          id: ++logIdRef.current,
          timestamp: formatTimestamp(elapsedSeconds),
          text: `✗ Pipeline failed — ${pipeStatus?.error_message ?? 'unknown error'}`,
        },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComplete, isFailed]);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines]);

  // Stage status
  const scrapeStatus: StageStatus =
    isComplete ? 'complete' : isRunning ? 'active' : 'pending';

  const researchStatus: StageStatus =
    isComplete
      ? 'complete'
      : isRunning && elapsedSeconds >= 25
      ? enriched > 0
        ? 'complete'
        : 'active'
      : 'pending';

  const enrichStatus: StageStatus =
    isComplete ? 'complete' : enriched > 0 ? 'active' : 'pending';

  const throughput =
    elapsedSeconds > 30 && enriched > 0
      ? ((enriched / elapsedSeconds) * 60).toFixed(1)
      : '—';

  const enrichedPct =
    scraped > 0 ? Math.min(100, (enriched / scraped) * 100) : 0;

  const headerStatusColor = isComplete ? '#00E87A' : isFailed ? '#FF4757' : '#00C8FF';
  const headerStatusBg =
    isComplete ? 'rgba(0,232,122,0.1)' : isFailed ? 'rgba(255,71,87,0.1)' : 'rgba(0,200,255,0.1)';
  const headerStatusBorder =
    isComplete ? 'rgba(0,232,122,0.3)' : isFailed ? 'rgba(255,71,87,0.3)' : 'rgba(0,200,255,0.3)';

  if (!mounted) return null;

  const modal = (
    <div
      className="fixed inset-0 flex flex-col"
      style={{
        background: '#08090C',
        zIndex: 9999,
      }}
    >
      <div className="modal-enter flex flex-col h-full max-w-5xl mx-auto w-full px-4 sm:px-6 py-5">

        {/* ── Header ── */}
        <div
          className="flex items-center justify-between pb-4 mb-4 flex-wrap gap-3"
          style={{ borderBottom: '1px solid #1C2333' }}
        >
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className="font-mono text-xs px-2.5 py-1 rounded-full pipeline-pulse"
              style={{
                background: headerStatusBg,
                color: headerStatusColor,
                border: `1px solid ${headerStatusBorder}`,
              }}
            >
              {isComplete ? '✓ MISSION COMPLETE' : isFailed ? '✗ PIPELINE FAILED' : '◈ PIPELINE EXECUTING'}
            </span>
            <span className="text-xs font-mono" style={{ color: '#3D4558' }}>
              {postalCode} · us · {distance}mi
            </span>
            <span className="text-xs font-mono" style={{ color: '#7A8499' }}>
              {formatElapsed(elapsedSeconds)}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-sm font-mono px-3 py-1.5 rounded-lg transition-all duration-150"
            style={{ color: '#7A8499', background: '#0F1117', border: '1px solid #1C2333' }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = '#E8ECF4';
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#2D3748';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = '#7A8499';
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#1C2333';
            }}
          >
            ╳ Close
          </button>
        </div>

        {/* ── Mission Complete banner ── */}
        {isComplete && (
          <div
            className="mission-complete-enter mb-6 rounded-2xl p-6 text-center"
            style={{
              background: 'rgba(0,232,122,0.04)',
              border: '1px solid rgba(0,232,122,0.2)',
            }}
          >
            <p
              className="text-4xl font-heading font-bold tracking-tight mb-1"
              style={{ color: '#00E87A' }}
            >
              MISSION COMPLETE
            </p>
            <p className="text-sm font-mono" style={{ color: '#7A8499' }}>
              {enriched} leads enriched and scored in {formatElapsed(elapsedSeconds)}
            </p>
          </div>
        )}

        {/* ── Main 3-column layout ── */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[160px_1fr_200px] gap-4">

          {/* Stage flow */}
          <div
            className="rounded-xl p-4 flex flex-col items-center"
            style={{ background: '#0F1117', border: '1px solid #1C2333' }}
          >
            <p
              className="text-xs font-mono uppercase tracking-widest mb-5 self-start"
              style={{ color: '#3D4558' }}
            >
              Stages
            </p>

            {/* Desktop: vertical */}
            <div className="hidden lg:flex flex-col items-center">
              <StageNode label="SCRAPE" sublabel="GAF directory" status={scrapeStatus} showConnector />
              <StageNode label="RESEARCH" sublabel="Perplexity AI" status={researchStatus} showConnector />
              <StageNode label="ENRICH" sublabel="Claude AI" status={enrichStatus} showConnector={false} />
            </div>

            {/* Mobile: horizontal */}
            <div className="lg:hidden flex items-center justify-around w-full gap-2">
              {([
                { label: 'SCRAPE', status: scrapeStatus },
                { label: 'RESEARCH', status: researchStatus },
                { label: 'ENRICH', status: enrichStatus },
              ] as const).map(({ label, status }, i) => {
                const { node } = getStageColors(status);
                const cls = status === 'active' ? 'node-active' : status === 'complete' ? 'node-complete' : '';
                return (
                  <React.Fragment key={label}>
                    <div className="flex flex-col items-center gap-1">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-mono font-bold ${cls}`}
                        style={{
                          background: status === 'pending' ? '#0F1117' : `${node}18`,
                          border: `2px solid ${node}`,
                          color: node,
                          transition: 'all 0.5s ease',
                        }}
                      >
                        {status === 'complete' ? '✓' : status === 'active' ? '◈' : '○'}
                      </div>
                      <span className="text-xs font-mono" style={{ color: node, fontSize: 10 }}>{label}</span>
                    </div>
                    {i < 2 && <div style={{ width: 20, height: 1, background: '#1C2333', flexShrink: 0 }} />}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* Terminal log */}
          <div
            className="rounded-xl flex flex-col overflow-hidden"
            style={{ background: '#161B22', border: '1px solid #1C2333' }}
          >
            <div
              className="px-4 py-3 flex items-center gap-2 shrink-0"
              style={{ borderBottom: '1px solid #1C2333' }}
            >
              <span className="text-xs font-mono uppercase tracking-widest" style={{ color: '#3D4558' }}>
                Mission Log
              </span>
              <div className="flex gap-1 ml-auto">
                {['#FF4757', '#FFB020', '#00E87A'].map((c) => (
                  <div
                    key={c}
                    style={{ width: 8, height: 8, borderRadius: '50%', background: c, opacity: 0.5 }}
                  />
                ))}
              </div>
            </div>

            <div ref={logRef} className="flex-1 overflow-y-auto p-4 space-y-1.5" style={{ minHeight: 0 }}>
              {logLines.length === 0 && (
                <p style={{ fontSize: 12, fontFamily: 'var(--font-jetbrains)', color: '#3D4558' }}>
                  Initializing...
                </p>
              )}

              {logLines.map((line) => (
                <div key={line.id} className="flex gap-3 animate-slide-up" style={{ fontSize: 12, lineHeight: 1.6 }}>
                  <span
                    style={{ color: '#3D4558', fontFamily: 'var(--font-jetbrains)', flexShrink: 0 }}
                  >
                    {line.timestamp}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-jetbrains)',
                      color: line.text.startsWith('✓')
                        ? '#00E87A'
                        : line.text.startsWith('✗')
                        ? '#FF4757'
                        : line.text.startsWith('⚡')
                        ? '#00C8FF'
                        : line.text.startsWith('◈')
                        ? '#FFB020'
                        : '#E8ECF4',
                    }}
                  >
                    {line.text}
                  </span>
                </div>
              ))}

              {isRunning && (
                <div style={{ fontSize: 12, fontFamily: 'var(--font-jetbrains)', color: '#00C8FF' }}>
                  <span className="terminal-cursor">▊</span>
                </div>
              )}
            </div>
          </div>

          {/* Stats panel */}
          <div
            className="rounded-xl p-4 flex flex-col gap-3"
            style={{ background: '#0F1117', border: '1px solid #1C2333' }}
          >
            <p className="text-xs font-mono uppercase tracking-widest" style={{ color: '#3D4558' }}>
              Live Stats
            </p>

            <StatBlock value={scraped} label="Scraped" color="#00C8FF" animKey={scraped} />
            <StatBlock value={enriched} label="Enriched" color="#00E87A" animKey={enriched} />
            <StatBlock value={throughput} label="leads/min" color="#FFB020" animKey={throughput} />

            <div
              className="rounded-xl p-4 flex flex-col items-center gap-1"
              style={{ background: '#161B22', border: '1px solid #1C2333' }}
            >
              <span className="text-2xl font-heading font-bold" style={{ color: '#7A8499' }}>
                {formatElapsed(elapsedSeconds)}
              </span>
              <span className="text-xs font-mono uppercase tracking-widest" style={{ color: '#3D4558' }}>
                Elapsed
              </span>
            </div>
          </div>
        </div>

        {/* ── Progress footer ── */}
        <div className="mt-4 pt-4" style={{ borderTop: '1px solid #1C2333' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono" style={{ color: '#3D4558' }}>
              {isComplete
                ? 'All leads processed'
                : isFailed
                ? 'Pipeline failed'
                : enrichedPct > 0
                ? `${Math.round(enrichedPct)}% enriched`
                : isRunning
                ? 'Acquiring leads...'
                : '—'}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-mono transition-colors duration-150"
              style={{ color: '#3D4558' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#7A8499'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#3D4558'; }}
            >
              Minimize — pipeline continues in background
            </button>
          </div>

          <div className="h-1 rounded-full overflow-hidden" style={{ background: '#1C2333' }}>
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: isComplete ? '100%' : `${Math.max(enrichedPct > 0 ? enrichedPct : isRunning ? 4 : 0, 0)}%`,
                background: isComplete
                  ? '#00E87A'
                  : isFailed
                  ? '#FF4757'
                  : 'linear-gradient(90deg, #00C8FF, #00E87A)',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(modal, document.body);
}
