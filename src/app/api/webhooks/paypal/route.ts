/**
 * app/api/webhooks/paypal/route.ts
 * Endpoint: POST /api/webhooks/paypal
 *
 * Este endpoint es la pieza central del experimento.
 * Solo aquí se crean participantes y se actualiza el contador oficial.
 *
 * Flujo de seguridad:
 * 1. Verificar firma del webhook de PayPal (autenticidad).
 * 2. Verificar idempotencia en webhook_events (evitar duplicados).
 * 3. Marcar el evento como "en proceso".
 * 4. Solo si el evento es PAYMENT.CAPTURE.COMPLETED:
 *    a. Extraer el payer identifier (payer_id > email).
 *    b. Generar identity_hash.
 *    c. Llamar a la RPC de Supabase para crear/encontrar participante.
 *    d. Actualizar el registro de payment a "completed".
 * 5. Marcar el evento como "processed".
 * 6. Responder 200 OK a PayPal para que no reintente.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { verifyPaypalWebhook } from '@/lib/paypal'
import { generateIdentityHash, extractPayerIdentifier } from '@/lib/identity'
import { getPostHogClient } from '@/lib/posthog'

const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID!

export async function POST(req: NextRequest) {
  // --- Leer body como texto para verificación de firma ---
  const rawBody = await req.text()
  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => { headers[key] = value })

  let event: Record<string, unknown>
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // 1. Verificar autenticidad del webhook
  const isValid = await verifyPaypalWebhook({ headers, rawBody, webhookId: PAYPAL_WEBHOOK_ID })
  if (!isValid) {
    console.warn('[webhook] Invalid PayPal webhook signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const eventId = event.id as string
  const eventType = event.event_type as string

  // 2. Idempotencia: intentar insertar el evento
  const { error: idempotencyError } = await supabaseAdmin
    .from('webhook_events')
    .insert({
      provider: 'paypal',
      provider_event_id: eventId,
      event_type: eventType,
      processing_status: 'pending',
    })

  if (idempotencyError) {
    // El evento ya fue procesado (UNIQUE constraint disparado)
    console.log(`[webhook] Duplicate event received and ignored: ${eventId}`)
    return NextResponse.json({ status: 'already_processed' }, { status: 200 })
  }

  // 3. Solo procesamos pagos capturados exitosamente
  if (eventType !== 'PAYMENT.CAPTURE.COMPLETED') {
    await supabaseAdmin
      .from('webhook_events')
      .update({ processing_status: 'skipped', processed_at: new Date().toISOString() })
      .eq('provider_event_id', eventId)
      .eq('provider', 'paypal')

    return NextResponse.json({ status: 'event_type_ignored' }, { status: 200 })
  }

  try {
    const resource = event.resource as Record<string, unknown>
    const payer = resource.payer as { payer_id?: string; email_address?: string }
    const capture = (resource as Record<string, unknown>)
    const purchaseUnits = ((event.resource as Record<string, unknown>))
    
    // Extraer datos del evento de PayPal
    const transactionId = resource.id as string
    const amountValue = (resource.amount as { value: string })?.value
    const amountCents = Math.round(parseFloat(amountValue) * 100)
    const currency = (resource.amount as { currency_code: string })?.currency_code ?? 'USD'

    // Extraer el custom_id (nuestro internal payment id) desde supplementary_data
    const supplementaryData = resource.supplementary_data as Record<string, unknown> | undefined
    const relatedIds = supplementaryData?.related_ids as Record<string, string> | undefined
    const orderId = relatedIds?.order_id ?? (capture?.id as string)

    // Buscar nuestro payment por order_id para obtener attribution
    const { data: existingPayment } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('provider_order_id', orderId)
      .maybeSingle()

    // 4a. Extraer identidad y generar hash
    const rawIdentifier = extractPayerIdentifier(payer)
    const identityHash = generateIdentityHash(rawIdentifier)

    let participantId: string
    let participantNumber: number
    let isNewParticipant = false

    // 4b. La RPC maneja atómicamente ambos casos:
    //   - Retorna UUID  → nuevo participante creado, contador incrementado
    //   - Retorna NULL  → identidad ya existía, contador NO se modifica
    const { data: rpcResult, error: rpcError } = await supabaseAdmin
      .rpc('register_new_participant', {
        p_identity_hash: identityHash,
        p_first_campaign_source: existingPayment?.campaign_source ?? null,
        p_first_referral_source: existingPayment?.referral_source ?? null,
        p_first_touch_source: existingPayment?.first_touch_source ?? null,
        p_last_touch_source: existingPayment?.last_touch_source ?? null,
      })

    if (rpcError) {
      throw new Error(`RPC register_new_participant failed: ${rpcError.message}`)
    }

    if (rpcResult) {
      // Nuevo participante creado
      isNewParticipant = true
      const { data: createdParticipant } = await supabaseAdmin
        .from('participants')
        .select('participant_number')
        .eq('id', rpcResult)
        .single()

      participantId = rpcResult
      participantNumber = createdParticipant?.participant_number
    } else {
      // Participante ya existía — buscamos su info para el log
      const { data: existingParticipant } = await supabaseAdmin
        .from('participants')
        .select('id, participant_number')
        .eq('identity_hash', identityHash)
        .single()

      if (!existingParticipant) {
        throw new Error('RPC returned NULL but participant not found by identity_hash')
      }

      participantId = existingParticipant.id
      participantNumber = existingParticipant.participant_number
    }

    // 4d. Actualizar el registro de payment a "completed"
    if (existingPayment) {
      await supabaseAdmin
        .from('payments')
        .update({
          participant_id: participantId,
          provider_transaction_id: transactionId,
          provider_order_id: orderId,
          amount_cents: amountCents,
          currency,
          status: 'completed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingPayment.id)
    } else {
      // Insertar un nuevo registro si no encontramos el pending (caso edge)
      await supabaseAdmin.from('payments').insert({
        participant_id: participantId,
        provider: 'paypal',
        provider_transaction_id: transactionId,
        provider_order_id: orderId,
        amount_cents: amountCents,
        currency,
        status: 'completed',
      })
    }

    // 5. Marcar evento como procesado
    await supabaseAdmin
      .from('webhook_events')
      .update({ processing_status: 'processed', processed_at: new Date().toISOString() })
      .eq('provider_event_id', eventId)
      .eq('provider', 'paypal')

    console.log(
      `[webhook] OK | Participant #${participantNumber} | New: ${isNewParticipant} | Tx: ${transactionId}`
    )

    const posthog = getPostHogClient()
    if (posthog) {
      posthog.capture({
        distinctId: identityHash,
        event: 'payment_completed',
        properties: {
          participantNumber,
          isNewParticipant,
          amountCents,
          source: 'webhook'
        }
      })
      
      if (isNewParticipant) {
        posthog.capture({
          distinctId: identityHash,
          event: 'participant_created',
          properties: {
            participantNumber,
            amountCents
          }
        })
      }
      await posthog.shutdown() // Ensures events are flushed
    }

    return NextResponse.json({ status: 'ok', participantNumber, isNewParticipant })
  } catch (err) {
    console.error('[webhook] Processing error:', err)

    // Marcar evento como fallido para poder investigar después
    await supabaseAdmin
      .from('webhook_events')
      .update({ processing_status: 'failed', processed_at: new Date().toISOString() })
      .eq('provider_event_id', eventId)
      .eq('provider', 'paypal')

    // Devolvemos 200 a PayPal de todas formas para que no reintente infinitamente
    return NextResponse.json({ status: 'processing_failed' }, { status: 200 })
  }
}
