/**
 * app/api/capture/route.ts
 * Endpoint: POST /api/capture
 *
 * Llamado por el frontend cuando el usuario vuelve de PayPal.
 * Captura el pago, identifica al participante, y registra todo.
 *
 * Esto reemplaza la dependencia del webhook para localhost/sandbox.
 * El webhook queda como respaldo en producción.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { capturePaypalOrder } from '@/lib/paypal'
import { generateIdentityHash, extractPayerIdentifier } from '@/lib/identity'
import { getPostHogClient } from '@/lib/posthog'

export async function POST(req: NextRequest) {
  try {
    const { paymentId, orderId, posthogDistinctId } = await req.json()

    if (!paymentId || !orderId) {
      return NextResponse.json({ error: 'Missing paymentId or orderId' }, { status: 400 })
    }

    // 1. Verificar que el payment existe y está pending
    const { data: payment, error: paymentError } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .single()

    if (paymentError || !payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    // Si ya fue procesado (por webhook u otra llamada), devolvemos el resultado
    if (payment.status === 'completed' && payment.participant_id) {
      const { data: participant } = await supabaseAdmin
        .from('participants')
        .select('participant_number')
        .eq('id', payment.participant_id)
        .single()

      return NextResponse.json({
        status: 'completed',
        participantNumber: participant?.participant_number,
        alreadyProcessed: true,
      })
    }

    // 2. Capturar el pago en PayPal
    let captureResult
    try {
      captureResult = await capturePaypalOrder(orderId, paymentId)
    } catch (captureErr: unknown) {
      const errMsg = captureErr instanceof Error ? captureErr.message : ''
      // Si ya fue capturado (doble llamada, strict mode, etc.), buscamos en nuestra DB
      if (errMsg.includes('ORDER_ALREADY_CAPTURED')) {
        // Re-check DB — quizás la otra llamada paralela ya lo procesó
        const { data: retryPayment } = await supabaseAdmin
          .from('payments')
          .select('status, participant_id')
          .eq('id', paymentId)
          .single()

        if (retryPayment?.status === 'completed' && retryPayment.participant_id) {
          const { data: p } = await supabaseAdmin
            .from('participants')
            .select('participant_number')
            .eq('id', retryPayment.participant_id)
            .single()

          return NextResponse.json({
            status: 'completed',
            participantNumber: p?.participant_number,
            alreadyProcessed: true,
          })
        }
        // Si no está en nuestra DB aún, devolvemos pending para que el polling lo resuelva
        return NextResponse.json({ status: 'pending' })
      }
      throw captureErr
    }

    // 3. Generar identity hash
    const rawIdentifier = extractPayerIdentifier(captureResult.payer)
    const identityHash = generateIdentityHash(rawIdentifier)

    // 4. Crear o encontrar participante via RPC
    let participantId: string
    let participantNumber: number
    let isNewParticipant = false

    const { data: rpcResult, error: rpcError } = await supabaseAdmin
      .rpc('register_new_participant', {
        p_identity_hash: identityHash,
        p_first_campaign_source: payment.campaign_source ?? null,
        p_first_referral_source: payment.referral_source ?? null,
        p_first_touch_source: payment.first_touch_source ?? null,
        p_last_touch_source: payment.last_touch_source ?? null,
      })

    if (rpcError) {
      throw new Error(`RPC failed: ${rpcError.message}`)
    }

    if (rpcResult) {
      isNewParticipant = true
      participantId = rpcResult

      const { data: created } = await supabaseAdmin
        .from('participants')
        .select('participant_number')
        .eq('id', rpcResult)
        .single()

      participantNumber = created?.participant_number
    } else {
      const { data: existing } = await supabaseAdmin
        .from('participants')
        .select('id, participant_number')
        .eq('identity_hash', identityHash)
        .single()

      if (!existing) throw new Error('RPC returned NULL but participant not found')

      participantId = existing.id
      participantNumber = existing.participant_number
    }

    // 5. Actualizar payment a completed
    await supabaseAdmin
      .from('payments')
      .update({
        participant_id: participantId,
        provider_transaction_id: captureResult.transactionId,
        provider_order_id: orderId,
        amount_cents: captureResult.amountCents,
        currency: captureResult.currency,
        status: 'completed',
      })
      .eq('id', paymentId)

    console.log(
      `[capture] OK | Participant #${participantNumber} | New: ${isNewParticipant} | Tx: ${captureResult.transactionId}`
    )

    const posthog = getPostHogClient()
    if (posthog) {
      if (posthogDistinctId) {
        posthog.alias({ distinctId: identityHash, alias: posthogDistinctId })
      }

      posthog.capture({
        distinctId: identityHash,
        event: 'payment_completed',
        properties: {
          participantNumber,
          isNewParticipant,
          amountCents: captureResult.amountCents,
          source: 'capture_endpoint'
        }
      })

      if (isNewParticipant) {
        posthog.capture({
          distinctId: identityHash,
          event: 'participant_created',
          properties: {
            participantNumber,
            amountCents: captureResult.amountCents
          }
        })
      }
      
      await posthog.shutdown() // Ensures events are flushed before serverless function exits
    }

    return NextResponse.json({
      status: 'completed',
      participantNumber,
      isNewParticipant,
    })
  } catch (err) {
    console.error('[capture] Error:', err)
    return NextResponse.json({ error: 'Capture failed' }, { status: 500 })
  }
}
