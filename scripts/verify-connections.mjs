/**
 * scripts/verify-connections.mjs
 *
 * Script de verificación de conexiones a servicios externos.
 * Ejecutar con: node scripts/verify-connections.mjs
 *
 * Lee las variables de .env.local y prueba:
 *   1. Variables de entorno presentes
 *   2. Conexión a Supabase (tabla experiment_stats)
 *   3. Autenticación a PayPal Sandbox (OAuth token)
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// --- Cargar .env.local manualmente (sin dependencias extras) ---
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../.env.local')

try {
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const [key, ...rest] = trimmed.split('=')
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim()
  }
  console.log('✅ .env.local cargado correctamente\n')
} catch {
  console.error('❌ No se encontró .env.local. Crea el archivo primero.')
  process.exit(1)
}

// --- 1. Verificar variables de entorno presentes ---
console.log('='.repeat(50))
console.log('1. VARIABLES DE ENTORNO')
console.log('='.repeat(50))

const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'IDENTITY_SALT_SECRET',
  'NEXT_PUBLIC_PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_API_BASE',
  'NEXT_PUBLIC_APP_URL',
]

const optional = ['PAYPAL_WEBHOOK_ID', 'NEXT_PUBLIC_POSTHOG_KEY', 'NEXT_PUBLIC_POSTHOG_HOST']

let allRequired = true
for (const key of required) {
  const value = process.env[key]
  if (!value || value.startsWith('your_') || value.startsWith('generate_')) {
    console.log(`  ❌ FALTA: ${key}`)
    allRequired = false
  } else {
    // Mostrar solo los primeros 8 caracteres por seguridad
    console.log(`  ✅ ${key} = ${value.substring(0, 8)}...`)
  }
}

for (const key of optional) {
  const value = process.env[key]
  if (!value || value.startsWith('your_')) {
    console.log(`  ⚠️  OPCIONAL (vacío): ${key}`)
  } else {
    console.log(`  ✅ ${key} = ${value.substring(0, 8)}...`)
  }
}

if (!allRequired) {
  console.log('\n❌ Hay variables requeridas incompletas. Completa el .env.local primero.\n')
  process.exit(1)
}

// --- 2. Verificar conexión a Supabase ---
console.log('\n' + '='.repeat(50))
console.log('2. CONEXIÓN A SUPABASE')
console.log('='.repeat(50))

try {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  const res = await fetch(`${supabaseUrl}/rest/v1/experiment_stats?id=eq.1&select=participant_count`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  })

  if (!res.ok) {
    const body = await res.text()
    console.log(`  ❌ Error HTTP ${res.status}: ${body}`)
  } else {
    const data = await res.json()
    if (data.length === 0) {
      console.log('  ⚠️  Supabase conectado, pero experiment_stats está vacío.')
      console.log('     Revisa si ejecutaste schema.sql correctamente.')
    } else {
      console.log(`  ✅ Supabase conectado. participant_count = ${data[0].participant_count}`)
    }
  }
} catch (err) {
  console.log(`  ❌ No se pudo conectar a Supabase: ${err.message}`)
}

// --- 3. Verificar autenticación a PayPal Sandbox ---
console.log('\n' + '='.repeat(50))
console.log('3. AUTENTICACIÓN PAYPAL SANDBOX')
console.log('='.repeat(50))

try {
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET
  const apiBase = process.env.PAYPAL_API_BASE

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const res = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  if (!res.ok) {
    const body = await res.text()
    console.log(`  ❌ Error HTTP ${res.status}: ${body}`)
    console.log('     Revisa tu Client ID y Client Secret de PayPal.')
  } else {
    const data = await res.json()
    const tokenPreview = data.access_token?.substring(0, 12) ?? 'N/A'
    console.log(`  ✅ PayPal autenticado. Token obtenido: ${tokenPreview}...`)
    console.log(`     Expires in: ${data.expires_in}s`)
  }
} catch (err) {
  console.log(`  ❌ No se pudo conectar a PayPal: ${err.message}`)
}

console.log('\n' + '='.repeat(50))
console.log('Verificación completa.')
console.log('='.repeat(50))
