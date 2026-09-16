'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePostHog } from 'posthog-js/react'

export default function SuccessPage() {
  const [status, setStatus] = useState<'processing' | 'confirmed' | 'error'>('processing')
  const [participantNumber, setParticipantNumber] = useState<number | null>(null)
  const [referralLink, setReferralLink] = useState('')
  const posthog = usePostHog()

  // Guard: evita que Strict Mode (o cualquier re-render) dispare capture dos veces
  const captureInitiated = useRef(false)

  const setConfirmed = (pNumber: number) => {
    setStatus('confirmed')
    setParticipantNumber(pNumber)
    setReferralLink(`${window.location.origin}/?ref=p${pNumber}`)
  }

  const processPayment = useCallback(async () => {
    // Si ya se inició, no hacer nada (Strict Mode guard)
    if (captureInitiated.current) return
    captureInitiated.current = true

    const params = new URLSearchParams(window.location.search)
    const paymentId = params.get('paymentId')
    const token = params.get('token') // PayPal agrega el Order ID como ?token=

    if (!paymentId) {
      setStatus('error')
      return
    }

    // Si tenemos el token de PayPal, capturamos activamente
    if (token) {
      try {
        const res = await fetch('/api/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            paymentId, 
            orderId: token,
            posthogDistinctId: posthog ? posthog.get_distinct_id() : null 
          }),
        })

        const data = await res.json()
        if (data.status === 'completed' && data.participantNumber) {
          setConfirmed(data.participantNumber)
          return
        }
        // Si devuelve 'pending', caemos al polling
      } catch {
        // Si capture falla por red, caemos al polling
      }
    }

    // Fallback: polling de payment-status
    let attempts = 0
    const maxAttempts = 20

    const poll = async () => {
      try {
        const res = await fetch(`/api/payment-status?paymentId=${paymentId}`)
        const data = await res.json()

        if (data.status === 'completed' && data.participantNumber) {
          setConfirmed(data.participantNumber)
          return
        }
      } catch { /* retry */ }

      attempts++
      if (attempts < maxAttempts) {
        setTimeout(poll, 3000)
      } else {
        setStatus('error')
      }
    }

    poll()
  }, [])

  useEffect(() => {
    processPayment()
  }, [processPayment])

  const copyLink = () => {
    navigator.clipboard.writeText(referralLink)
    if (posthog) {
      posthog.capture('share_clicked')
    }
  }

  if (status === 'processing') {
    return (
      <section className="success">
        <div className="success__processing">
          <span className="spinner" />
          Confirming your payment...
        </div>
      </section>
    )
  }

  if (status === 'error') {
    return (
      <section className="success">
        <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Payment Pending</h1>
        <p className="success__message">
          We couldn&apos;t confirm your payment yet. Don&apos;t pay again —
          we&apos;re verifying the transaction. Check back shortly.
        </p>
        <a href="/" className="cta" style={{ fontSize: '0.85rem' }}>Back to experiment</a>
      </section>
    )
  }

  return (
    <section className="success">
      <div className="success__number">#{participantNumber}</div>
      <div className="success__label">You are participant</div>
      <p className="success__message">
        You&apos;re now part of the experiment. Thank you for your curiosity.
      </p>

      <div className="success__share-label">Share your referral link</div>
      <div className="success__link" onClick={copyLink} title="Click to copy">
        {referralLink}
      </div>
      <p style={{ fontSize: '0.75rem', color: 'var(--fg-dim)', marginTop: '0.5rem' }}>
        Click to copy
      </p>

      <a href="/" className="cta" style={{ marginTop: '2.5rem', fontSize: '0.85rem' }}>
        Back to experiment
      </a>
    </section>
  )
}
