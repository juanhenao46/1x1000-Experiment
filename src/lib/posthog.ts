/**
 * lib/posthog.ts
 * Configuración del cliente de servidor de PostHog para Node.js
 */

import { PostHog } from 'posthog-node'

let posthogClient: PostHog | null = null

export function getPostHogClient() {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
  const apiHost = process.env.NEXT_PUBLIC_POSTHOG_HOST

  if (!apiKey || !apiHost) {
    console.warn('PostHog environment variables are missing. Backend events will not be tracked.')
    return null
  }

  if (!posthogClient) {
    posthogClient = new PostHog(apiKey, { host: apiHost })
  }
  return posthogClient
}
