'use client'

/**
 * useLeadsRealtime — subscribes to Supabase Postgres changes and merges
 * incoming lead updates into local state.
 *
 * The hook accepts an initial leads array (fetched server-side) and returns
 * a live copy that updates automatically when the backend enriches a lead.
 *
 * Design notes:
 * - No server-side filter is set on the subscription because filtered
 *   postgres_changes require Row Level Security to be enabled on the table.
 *   Instead, all UPDATE events flow through and are merged by id client-side.
 * - The initialLeads effect re-syncs state whenever the parent Server Component
 *   re-fetches (e.g. after router.refresh() is called by PipelineControls).
 */
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Lead } from '@/lib/types'

export function useLeadsRealtime(initialLeads: Lead[]): Lead[] {
  const [leads, setLeads] = useState<Lead[]>(initialLeads)

  // Sync state when the server re-fetches (e.g. after router.refresh())
  useEffect(() => {
    setLeads(initialLeads)
  }, [initialLeads])

  useEffect(() => {
    const channel = supabase
      .channel('leads-realtime')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'leads',
          // No server-side filter: filtered postgres_changes require RLS to be enabled.
          // All UPDATE events flow through; stale leads are merged by id below.
        },
        (payload) => {
          const incoming = payload.new as Lead
          setLeads((prev) => {
            const exists = prev.some((l) => l.id === incoming.id)
            // Append new leads that arrived during the current session
            return exists
              ? prev.map((l) => (l.id === incoming.id ? incoming : l))
              : [...prev, incoming]
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, []) // subscribe once on mount; channel is cleaned up on unmount

  return leads
}
