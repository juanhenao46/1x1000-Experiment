'use client'

import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'

if (typeof window !== 'undefined') {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
  const apiHost = process.env.NEXT_PUBLIC_POSTHOG_HOST

  if (apiKey && apiHost) {
    posthog.init(apiKey, {
      api_host: apiHost,
      person_profiles: 'identified_only',
      capture_pageview: false, // Desactivado, usaremos experiment_viewed
      autocapture: false, // Desactivado por solicitud del usuario
    })
  } else {
    console.warn('PostHog environment variables are missing. Analytics will not be tracked.')
  }
}

export function CSPostHogProvider({ children }: { children: React.ReactNode }) {
  return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}
