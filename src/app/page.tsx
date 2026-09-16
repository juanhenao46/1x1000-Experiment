'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePostHog } from 'posthog-js/react'

/** Experiment start date — set to DAY 0 when officially launching */
const EXPERIMENT_START = new Date('2026-10-01T00:00:00Z')
const EXPERIMENT_DAYS = 90
const GOAL = 1000

interface Stats {
  participants: number
  totalUsd: string
}

export default function Home() {
  const [stats, setStats] = useState<Stats>({ participants: 0, totalUsd: '0.00' })
  const [daysElapsed, setDaysElapsed] = useState(0)
  const [amount, setAmount] = useState(100) // cents
  const [loading, setLoading] = useState(false)
  const posthog = usePostHog()

  // Fetch stats from backend (Source of Truth)
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/stats')
      if (res.ok) {
        const data = await res.json()
        setStats(data)
      }
    } catch { /* silent fail on stats fetch */ }
  }, [])

  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 60_000) // Refresh every 60s
    return () => clearInterval(interval)
  }, [fetchStats])

  useEffect(() => {
    const now = new Date()
    const diff = Math.floor((now.getTime() - EXPERIMENT_START.getTime()) / 86_400_000)
    setDaysElapsed(Math.max(0, Math.min(diff, EXPERIMENT_DAYS)))
  }, [])

  const progressPercent = Math.min((stats.participants / GOAL) * 100, 100)
  const nextParticipantNumber = stats.participants + 1

  // Store UTM and referral params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)

    // Referral
    const ref = params.get('ref')
    if (ref) {
      sessionStorage.setItem('1000x1_referral', ref)
      if (posthog) {
        posthog.capture('referral_visit', { referralSource: ref })
      }
    }

    // UTM — first touch vs last touch
    const utmSource = params.get('utm_source')
    if (utmSource) {
      const utmData = {
        source: utmSource,
        medium: params.get('utm_medium') || '',
        campaign: params.get('utm_campaign') || '',
        content: params.get('utm_content') || '',
      }
      // First touch: only set if not already stored
      if (!localStorage.getItem('1000x1_first_touch')) {
        localStorage.setItem('1000x1_first_touch', JSON.stringify(utmData))
      }
      // Last touch: always overwrite
      sessionStorage.setItem('1000x1_last_touch', JSON.stringify(utmData))
    }
  }, [])

  const handleParticipate = async () => {
    setLoading(true)
    if (posthog) {
      posthog.capture('click_participate', { amountCents: amount })
    }
    try {
      const firstTouch = localStorage.getItem('1000x1_first_touch')
      const lastTouch = sessionStorage.getItem('1000x1_last_touch')
      const referral = sessionStorage.getItem('1000x1_referral')

      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountCents: amount,
          campaignSource: lastTouch ? JSON.parse(lastTouch).campaign : null,
          referralSource: referral || null,
          firstTouchSource: firstTouch || null,
          lastTouchSource: lastTouch || null,
          posthogDistinctId: posthog ? posthog.get_distinct_id() : null,
        }),
      })

      const data = await res.json()
      if (data.approvalUrl) {
        window.location.href = data.approvalUrl
      }
    } catch (err) {
      console.error('Checkout error:', err)
    } finally {
      setLoading(false)
    }
  }

  const amounts = [
    { label: '$1', cents: 100 },
    { label: '$2', cents: 200 },
    { label: '$5', cents: 500 },
    { label: '$10', cents: 1000 },
  ]

  return (
    <>
      {/* HERO */}
      <section className="hero">
        <h1 className="hero__formula">
          1,000 <span>×</span> $1
        </h1>
        <p className="hero__question">
          Can the internet help one ordinary person get 1,000 different people to contribute at least $1?
        </p>

        {/* STATS */}
        <div className="stats">
          <div className="stat">
            <div className="stat__value stat__value--accent">{stats.participants}</div>
            <div className="stat__label">Participants</div>
          </div>
          <div className="stat">
            <div className="stat__value">${stats.totalUsd}</div>
            <div className="stat__label">Raised</div>
          </div>
          <div className="stat">
            <div className="stat__value">{daysElapsed}</div>
            <div className="stat__label">Day / {EXPERIMENT_DAYS}</div>
          </div>
        </div>

        {/* PROGRESS */}
        <div className="progress">
          <div className="progress__bar">
            <div className="progress__fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="progress__label">{stats.participants} / {GOAL}</div>
        </div>

        {/* AMOUNT SELECTION */}
        <div className="amount-section">
          <div className="amount-options">
            {amounts.map(a => (
              <button
                key={a.cents}
                className={`amount-btn ${amount === a.cents ? 'amount-btn--active' : ''}`}
                onClick={() => setAmount(a.cents)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {/* CTA */}
        <button
          id="cta-participate"
          className="cta"
          onClick={handleParticipate}
          disabled={loading}
        >
          {loading ? 'Redirecting...' : `BECOME PARTICIPANT #${nextParticipantNumber}`}
        </button>
      </section>

      {/* ABOUT */}
      <section className="section" id="about">
        <div className="container">
          <h2 className="section__title">What Is This?</h2>
          <div className="section__content">
            <p>
              This is a public experiment. One person, no audience, no viral fame — 
              just an attempt to see if the internet can connect 1,000 strangers 
              willing to contribute at least $1 each.
            </p>
            <p>
              This is not a charity. Not a fundraiser. Not a startup. 
              It&apos;s a transparent, documented experiment about what&apos;s possible 
              when you combine curiosity, content, and distribution.
            </p>
            <p>
              Whether the experiment succeeds or fails, all results will be published openly. 
              The goal is to learn.
            </p>
          </div>
        </div>
      </section>

      {/* RULES */}
      <section className="section" id="rules">
        <div className="container">
          <h2 className="section__title">Rules</h2>
          <ul className="rules-list">
            <li>One person counts as one participant, regardless of how much they contribute.</li>
            <li>Minimum contribution: $1 USD.</li>
            <li>The official counter tracks participants, not money.</li>
            <li>No bots, fake accounts, or purchased participants.</li>
            <li>No spam, no deception, no manufactured engagement.</li>
            <li>Maximum duration: 90 days.</li>
            <li>Ends at 1,000 participants or Day 90, whichever comes first.</li>
            <li>Results will be published whether the experiment succeeds or fails.</li>
            <li>Rules cannot be changed retroactively to make the experiment appear successful.</li>
          </ul>
        </div>
      </section>

      {/* FAQ */}
      <section className="section" id="faq">
        <div className="container">
          <h2 className="section__title">FAQ</h2>
          <div className="faq">
            <details className="faq-item" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && posthog) posthog.capture('faq_expanded', { question: 'What happens with the money?' }) }}>
              <summary>What happens with the money?</summary>
              <div className="faq-item__answer">
                The person running the experiment keeps it. This is not a donation to a cause — 
                it&apos;s a micro-contribution to participate in an internet experiment. 
                Think of it as the price of curiosity.
              </div>
            </details>
            <details className="faq-item" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && posthog) posthog.capture('faq_expanded', { question: 'What if I contribute more than $1?' }) }}>
              <summary>What if I contribute more than $1?</summary>
              <div className="faq-item__answer">
                You still count as one participant. The experiment measures people, not dollars.
              </div>
            </details>
            <details className="faq-item" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && posthog) posthog.capture('faq_expanded', { question: 'Can I participate more than once?' }) }}>
              <summary>Can I participate more than once?</summary>
              <div className="faq-item__answer">
                You can contribute again, but you&apos;ll still count as one participant. 
                Duplicate contributions don&apos;t increase the participant counter.
              </div>
            </details>
            <details className="faq-item" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && posthog) posthog.capture('faq_expanded', { question: 'What if the experiment fails?' }) }}>
              <summary>What if the experiment fails?</summary>
              <div className="faq-item__answer">
                Then it fails publicly. All data, analysis, and learnings will be published regardless 
                of outcome. The point is to find out what happens, not to guarantee success.
              </div>
            </details>
            <details className="faq-item" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && posthog) posthog.capture('faq_expanded', { question: 'Who is behind this?' }) }}>
              <summary>Who is behind this?</summary>
              <div className="faq-item__answer">
                One person. A software engineer from Colombia running an experiment 
                about internet dynamics, micro-contributions, and social distribution.
              </div>
            </details>
            <details className="faq-item" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && posthog) posthog.capture('faq_expanded', { question: 'Is this legal?' }) }}>
              <summary>Is this legal?</summary>
              <div className="faq-item__answer">
                Yes. This is a voluntary contribution in exchange for participation in a 
                transparent public experiment. No false claims are made. All rules are public.
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <div className="container">
          1,000 × $1 Experiment · Day {daysElapsed} / {EXPERIMENT_DAYS}
        </div>
      </footer>
    </>
  )
}
