/**
 * lib/paypal.ts
 * Capa de abstracción del servicio de pagos de PayPal.
 *
 * El resto de la aplicación interactúa con estas funciones, no
 * directamente con la API de PayPal. Esto facilita el testing,
 * el mantenimiento y un eventual cambio de proveedor.
 *
 * ENTORNO: Controlar via PAYPAL_API_BASE en .env.local
 *   Sandbox:    https://api-m.sandbox.paypal.com
 *   Production: https://api-m.paypal.com
 */

const PAYPAL_API_BASE = process.env.PAYPAL_API_BASE!
const PAYPAL_CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID!
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET!

/** Obtiene un Access Token de PayPal usando Client Credentials */
async function getAccessToken(): Promise<string> {
  const credentials = Buffer.from(
    `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`
  ).toString('base64')

  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  if (!res.ok) {
    throw new Error(`PayPal auth failed: ${res.status} ${await res.text()}`)
  }

  const data = await res.json()
  return data.access_token
}

/**
 * Crea una Order de PayPal y retorna el ID y el link de aprobación.
 * @param amountUsd - El monto en dólares (ej: "1.00")
 * @param internalPaymentId - Nuestro ID de pago interno para rastreo
 * @param returnUrl - URL a la que vuelve el usuario tras aprobar
 * @param cancelUrl - URL a la que vuelve el usuario si cancela
 */
export async function createPaypalOrder(params: {
  amountUsd: string
  internalPaymentId: string
  returnUrl: string
  cancelUrl: string
}): Promise<{ orderId: string; approvalUrl: string }> {
  const token = await getAccessToken()

  const res = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          custom_id: params.internalPaymentId, // Nuestro ID interno
          amount: {
            currency_code: 'USD',
            value: params.amountUsd,
          },
        },
      ],
      application_context: {
        return_url: params.returnUrl,
        cancel_url: params.cancelUrl,
        user_action: 'PAY_NOW',
        brand_name: '1,000 × $1 Experiment',
      },
    }),
  })

  if (!res.ok) {
    throw new Error(`PayPal createOrder failed: ${res.status} ${await res.text()}`)
  }

  const data = await res.json()
  const approvalUrl = data.links.find(
    (l: { rel: string; href: string }) => l.rel === 'approve'
  )?.href

  if (!approvalUrl) throw new Error('No approval URL in PayPal response')

  return { orderId: data.id, approvalUrl }
}

/**
 * Captura el pago de una Order aprobada por el usuario.
 * @param orderId - El Order ID de PayPal (token de la URL de retorno)
 * @param requestId - Nuestro ID interno de pago, usado como PayPal-Request-Id para idempotencia
 */
export async function capturePaypalOrder(orderId: string, requestId?: string): Promise<{
  transactionId: string
  amountCents: number
  currency: string
  payer: { payer_id?: string; email_address?: string }
  customId: string
}> {
  const token = await getAccessToken()

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  // PayPal-Request-Id: si PayPal recibe dos POSTs con el mismo ID,
  // devuelve la respuesta cacheada en lugar de procesar de nuevo.
  if (requestId) {
    headers['PayPal-Request-Id'] = requestId
  }

  const res = await fetch(
    `${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`,
    { method: 'POST', headers }
  )

  if (!res.ok) {
    throw new Error(`PayPal captureOrder failed: ${res.status} ${await res.text()}`)
  }

  const data = await res.json()
  const capture = data.purchase_units[0].payments.captures[0]

  return {
    transactionId: capture.id,
    amountCents: Math.round(parseFloat(capture.amount.value) * 100),
    currency: capture.amount.currency_code,
    payer: data.payer,
    customId: data.purchase_units[0].custom_id,
  }
}

/**
 * Verifica que un webhook de PayPal es legítimo usando la API de verificación.
 * Siempre llama a esto antes de procesar cualquier webhook.
 */
export async function verifyPaypalWebhook(params: {
  headers: Record<string, string>
  rawBody: string
  webhookId: string
}): Promise<boolean> {
  const token = await getAccessToken()

  const res = await fetch(
    `${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: params.headers['paypal-auth-algo'],
        cert_url: params.headers['paypal-cert-url'],
        transmission_id: params.headers['paypal-transmission-id'],
        transmission_sig: params.headers['paypal-transmission-sig'],
        transmission_time: params.headers['paypal-transmission-time'],
        webhook_id: params.webhookId,
        webhook_event: JSON.parse(params.rawBody),
      }),
    }
  )

  if (!res.ok) return false
  const data = await res.json()
  return data.verification_status === 'SUCCESS'
}
