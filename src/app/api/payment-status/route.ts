/**
 * app/api/payment-status/route.ts
 * GET /api/payment-status?paymentId=xxx
 *
 * La success page consulta este endpoint para saber si el pago
 * fue confirmado y obtener el participant_number oficial.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const paymentId = req.nextUrl.searchParams.get('paymentId')

  if (!paymentId) {
    return NextResponse.json({ error: 'Missing paymentId' }, { status: 400 })
  }

  const { data: payment, error } = await supabaseAdmin
    .from('payments')
    .select('status, participant_id')
    .eq('id', paymentId)
    .maybeSingle()

  if (error || !payment) {
    return NextResponse.json({ status: 'not_found' }, { status: 404 })
  }

  if (payment.status !== 'completed' || !payment.participant_id) {
    return NextResponse.json({ status: 'pending' })
  }

  // Get participant number
  const { data: participant } = await supabaseAdmin
    .from('participants')
    .select('participant_number')
    .eq('id', payment.participant_id)
    .single()

  return NextResponse.json({
    status: 'completed',
    participantNumber: participant?.participant_number ?? null,
  })
}
