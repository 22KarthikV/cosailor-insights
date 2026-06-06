'use client'

/**
 * useLeadsRealtime — keeps the current page of leads live during a pipeline run.
 *
 * Two update paths, used in priority order:
 *
 * 1. Supabase Postgres Realtime (UPDATE events) — instant in-place card updates
 *    when enrichment writes a score. Only UPDATE is handled; INSERT events
 *    (new scraped leads) come via path 2 or via router.refresh().
 *
 * 2. Direct API polling — when the Realtime WebSocket is unavailable (e.g.
 *    blocked by a university proxy), the hook falls back to fetching the
 *    current page from the backend every POLL_INTERVAL_MS. This also picks
 *    up newly inserted scraped leads whose priority_index has been set.
 *
 * router.refresh() in PipelineControls covers total-count and pagination
 * updates every 3 s during a run; this hook handles within-page freshness.
 */
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getLeads } from '@/lib/api'
import type { Lead } from '@/lib/types'

const POLL_INTERVAL_MS = 5_000

export function useLeadsRealtime(
  initialLeads: Lead[],
  page: number,
  limit: number,
  scoreTier: string = 'all',
  sortBy: string = 'score_desc',
): Lead[] {
  const [leads, setLeads] = useState<Lead[]>(initialLeads)

  // Sync whenever the Server Component delivers a fresh initialLeads snapshot
  // (triggered by router.refresh() in PipelineControls).
  useEffect(() => {
    setLeads(initialLeads)
  }, [initialLeads])

  // Realtime subscription + polling fallback.
  // Re-runs when page/limit/scoreTier/sortBy changes so polling fetches the right slice.
  useEffect(() => {
    let active = true
    let polling: ReturnType<typeof setInterval> | null = null

    const startPolling = () => {
      if (polling) return
      polling = setInterval(async () => {
        if (!active) return
        try {
          const { leads: fresh } = await getLeads(page, limit, scoreTier, sortBy)
          if (active) setLeads(fresh)
        } catch {
          // transient network error — next tick will retry
        }
      }, POLL_INTERVAL_MS)
    }

    const channelName = `leads-realtime-p${page}-l${limit}-${Date.now()}`
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'leads' },
        (payload) => {
          const incoming = payload.new as Lead
          setLeads((prev) => prev.map((l) => (l.id === incoming.id ? incoming : l)))
        }
      )
      .subscribe((status) => {
        if (!active) return
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          supabase.removeChannel(channel)
          startPolling()
        }
      })

    return () => {
      active = false
      if (polling) clearInterval(polling)
      supabase.removeChannel(channel)
    }
  }, [page, limit, scoreTier, sortBy])

  return leads
}
