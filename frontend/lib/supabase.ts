/**
 * Supabase browser client for the Cosailor Insights frontend.
 *
 * This client is used exclusively for real-time Postgres change subscriptions
 * (see useLeadsRealtime). Regular data fetching goes through the FastAPI backend,
 * not directly through this client.
 *
 * Both env vars are validated at module load so the error surfaces at startup
 * rather than as a runtime failure inside a component.
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
if (!supabaseAnonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set')

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
