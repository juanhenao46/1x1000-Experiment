/**
 * lib/identity.ts
 * Genera un hash HMAC-SHA256 del identificador de PayPal para
 * deduplicar participantes sin almacenar datos personales (PII).
 *
 * REGLA OPERATIVA:
 * Usamos el `payer_id` de PayPal como identificador primario.
 * Es un ID de cuenta estable (ej: "XYZABC123") que no cambia aunque
 * el usuario cambie su email. Solo si `payer_id` no está disponible,
 * usamos el `email_address` normalizado como fallback.
 *
 * Esto es una regla de deduplicación operativa, no una prueba
 * de identidad física. Un mismo humano usando dos cuentas de PayPal
 * distintas contaría como dos participantes bajo esta regla.
 */
import { createHmac } from 'crypto'

function getIdentitySalt(): string {
  const salt = process.env.IDENTITY_SALT_SECRET
  if (!salt) throw new Error('Missing IDENTITY_SALT_SECRET environment variable')
  return salt
}

export function generateIdentityHash(rawIdentifier: string): string {
  const normalized = rawIdentifier.trim().toLowerCase()
  return createHmac('sha256', getIdentitySalt())
    .update(normalized)
    .digest('hex')
}

/**
 * Extrae el identificador canónico del payer de PayPal.
 * Prioridad: payer_id > email_address
 */
export function extractPayerIdentifier(payer: {
  payer_id?: string
  email_address?: string
}): string {
  if (payer.payer_id) return `paypal_id:${payer.payer_id}`
  if (payer.email_address) return `paypal_email:${payer.email_address}`
  throw new Error('Cannot determine payer identifier from PayPal response')
}
