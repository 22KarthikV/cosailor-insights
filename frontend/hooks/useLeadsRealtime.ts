'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Lead } from '@/lib/types'

export function useLeadsRealtime(initialLeads: Lead[]): Lead[] {
  const [leads, setLeads] = useState<Lead[]>(initialLeads)
  // Keep a ref so the effect closure always has the latest initialLeads
  const initialRef = useRef(initialLeads)

  // Sync state when server re-fetches (e.g. after router.refresh())
  useEffect(() => {
    initialRef.current = initialLeads
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
          filter: 'status=eq.enriched',
        },
        (payload) => {
          const incoming = payload.new as Lead
          setLeads((prev) => {
            const exists = prev.some((l) => l.id === incoming.id)
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
  }, []) // only subscribe once on mount

  return leads
}
