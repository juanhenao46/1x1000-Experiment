import type { Metadata } from 'next'
import './globals.css'

import { Suspense } from 'react'
import { CSPostHogProvider } from './providers'
import PostHogPageView from './PostHogPageView'

export const metadata: Metadata = {
  title: '1,000 × $1 Experiment',
  description: 'Can the internet help one ordinary person get 1,000 different people to contribute at least $1?',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <CSPostHogProvider>
          <Suspense fallback={null}>
            <PostHogPageView />
          </Suspense>
          {children}
        </CSPostHogProvider>
      </body>
    </html>
  )
}
