'use client'

import {
  CONTROL_BUTTON,
  DANGER_LABEL_TEXT,
  DANGER_SURFACE,
} from '@/components/dashboard/controls'

export default function RenderError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-2xl p-6">
      <section className={`rounded-lg border-2 p-5 ${DANGER_SURFACE}`}>
        <p className={`text-xs font-semibold uppercase tracking-widest ${DANGER_LABEL_TEXT}`}>
          This page failed to render — it is not showing you your errors
        </p>
        <h2 className="mt-2 text-lg font-semibold">Something failed while drawing the dashboard</h2>
        <p className="mt-1 text-sm">
          The Sentry data may have loaded fine. Check the server log for the correlation id.
        </p>
        <button
          type="button"
          onClick={reset}
          className={`${CONTROL_BUTTON} mt-3`}
        >
          Try again
        </button>
      </section>
    </main>
  )
}
