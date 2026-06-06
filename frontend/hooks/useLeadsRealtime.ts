'use client'

/**
 * useLeadsRealtime — subscribes to Supabase Postgres changes and merges
 * incoming lead updates into local state.
 *
 * The hook accepts an initial leads array (fetched server-side) and returns
 * a live copy that updates in place when the backend enriches a lead.
 *
 * Design notes:
 * - Only UPDATE events are handled. New leads (INSERT) are picked up via
 *   router.refresh() in PipelineControls, which re-fetches the current page
 *   from the server every 3 seconds during a pipeline run.
 * - Update-only (no append) keeps pagination stable: a realtime event for
 *   a lead on page 3 does not pollute the current page 1 view.
 * - The initialLeads effect re-syncs state whenever the parent Server Component
 *   re-fetches (e.g. after router.refresh() is called by PipelineControls).
 */
import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Lead } from '@/lib/types'

export function useLeadsRealtime(initialLeads: Lead[]): Lead[] {
  const channelRef = useRef(`leads-realtime-${crypto.randomUUID()}`)
  const [leads, setLeads] = useState<Lead[]>(initialLeads)

  useEffect(() => {
    setLeads(initialLeads)
  }, [initialLeads])

  useEffect(() => {
    let active = true

    const channel = supabase
      .channel(channelRef.current)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'leads',
        },
        (payload) => {
          const incoming = payload.new as Lead
          setLeads((prev) =>
            prev.map((l) => (l.id === incoming.id ? incoming : l))
          )
        }
      )
      .subscribe((status) => {
        // Network proxies (e.g. university networks) can block WSS upgrades.
        // On failure stop retrying — router.refresh() polling covers live updates.
        if (!active) return
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          supabase.removeChannel(channel)
        }
      })

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [])

  return leads
}
