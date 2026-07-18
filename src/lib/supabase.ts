import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

function cleanEnv(value: string | undefined) {
  return (value ?? '').replace(/^\uFEFF/, '').trim()
}

export const supabaseUrl = cleanEnv(import.meta.env.VITE_SUPABASE_URL)
export const supabasePublishableKey = cleanEnv(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)

export const supabase = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl, supabasePublishableKey)
  : null
