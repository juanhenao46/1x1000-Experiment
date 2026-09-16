/**
 * app/api/stats/route.ts
 * Endpoint: GET /api/stats
 *
 * Fuente oficial de datos para el contador del frontend.
 * SUPABASE = Source of Truth. Nunca PostHog, nunca localStorage.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export const revalidate = 60 // Cache de 60 segundos (ISR) para proteger la DB

export async function GET() {
  try {
    // 1. Participantes confirmados (desde el contador transaccional)
    const { data: stats, error: statsError } = await supabaseAdmin
      .from('experiment_stats')
      .select('participant_count')
      .eq('id', 1)
      .single()

    if (statsError) throw statsError

    // 2. Dinero total recaudado (suma de pagos completados)
    const { data: moneyData, error: moneyError } = await supabaseAdmin
      .from('payments')
      .select('amount_cents')
      .eq('status', 'completed')

    if (moneyError) throw moneyError

    const totalCents = (moneyData ?? []).reduce(
      (sum, p) => sum + (p.amount_cents ?? 0),
      0
    )

    return NextResponse.json({
      participants: stats.participant_count,
      totalCents,
      totalUsd: (totalCents / 100).toFixed(2),
    })
  } catch (err) {
    console.error('[stats] Error:', err)
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }
}
