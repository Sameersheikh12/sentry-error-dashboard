'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * One implementation of popover dismissal, used by every popover: outside pointer-down closes,
 * Escape closes, and focus returns to the trigger so keyboard users are not stranded.
 */
export function useDismissable<T extends HTMLElement>() {
  const containerRef = useRef<T | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)

  const close = useCallback((restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      const container = containerRef.current
      if (container && !container.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close(true)
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  return { containerRef, triggerRef, open, setOpen, close }
}
