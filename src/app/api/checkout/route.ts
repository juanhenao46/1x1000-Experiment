/**
 * app/api/checkout/route.ts
 * Endpoint: POST /api/checkout
 *
 * Flujo:
 * 1. Recibe el amount (USD) y los datos de attribution (utm, ref).
 * 2. Crea un registro "pending" en la tabla payments.
 * 3. Crea una Order en PayPal usando ese ID como custom_id.
 * 4. Devuelve la URL de aprobación de PayPal para redirigir al usuario.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { createPaypalOrder } from '@/lib/paypal'
import { getPostHogClient } from '@/lib/posthog'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const amountCents: number = body.amountCents ?? 100 // Mínimo $1.00
    const campaignSource: string | null = body.campaignSource ?? null
    const referralSource: string | null = body.referralSource ?? null
    const firstTouchSource: string | null = body.firstTouchSource ?? null
    const lastTouchSource: string | null = body.lastTouchSource ?? null
    const posthogDistinctId: string | null = body.posthogDistinctId ?? null

    // Validación de monto mínimo
    if (amountCents < 100) {
      return NextResponse.json(
        { error: 'Minimum contribution is $1.00 USD' },
        { status: 400 }
      )
    }

    // 1. Crear registro "pending" en Supabase
    const { data: payment, error: paymentError } = await supabaseAdmin
      .from('payments')
      .insert({
        provider: 'paypal',
        provider_transaction_id: `pending_${Date.now()}`, // Temporal, se actualiza en webhook
        amount_cents: amountCents,
        currency: 'USD',
        status: 'pending',
        campaign_source: campaignSource,
        referral_source: referralSource,
        first_touch_source: firstTouchSource,
        last_touch_source: lastTouchSource,
      })
      .select('id')
      .single()

    if (paymentError || !payment) {
      console.error('Supabase payment insert error:', paymentError)
      return NextResponse.json(
        { error: 'Failed to initialize payment' },
        { status: 500 }
      )
    }

    const internalPaymentId = payment.id
    const amountUsd = (amountCents / 100).toFixed(2)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

    // 2. Crear la Order en PayPal con nuestro ID como custom_id
    const { orderId, approvalUrl } = await createPaypalOrder({
      amountUsd,
      internalPaymentId,
      returnUrl: `${baseUrl}/success?paymentId=${internalPaymentId}`,
      cancelUrl: `${baseUrl}/?cancelled=true`,
    })

    // 3. Guardar el Order ID de PayPal en el registro pending
    await supabaseAdmin
      .from('payments')
      .update({ provider_order_id: orderId })
      .eq('id', internalPaymentId)

    const posthog = getPostHogClient()
    if (posthog) {
      posthog.capture({
        distinctId: posthogDistinctId || `anonymous-${internalPaymentId}`,
        event: 'checkout_started',
        properties: {
          amountCents,
          campaignSource,
          referralSource,
          internalPaymentId
        }
      })
      await posthog.shutdown() // Ensures events are flushed
    }

    return NextResponse.json({ approvalUrl })
  } catch (err) {
    console.error('Checkout error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
