/**
 * lib/supabase.ts
 * Cliente de Supabase para uso exclusivo del servidor (API Routes / Webhooks).
 * NUNCA importar este archivo desde componentes del lado del cliente.
 * Utiliza la SERVICE_ROLE_KEY para bypass de RLS.
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})
