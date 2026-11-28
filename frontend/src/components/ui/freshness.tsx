import { useEffect, useState } from 'react'
import { CircleAlert } from 'lucide-react'

import { cn } from '@/lib/utils'

type FreshnessProps = {
  updatedAt?: number
  staleAfterMs?: number
  className?: string
}

function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 2) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}

export function Freshness({
  updatedAt,
  staleAfterMs = 10_000,
  className,
}: FreshnessProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!updatedAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [updatedAt])

  if (!updatedAt) return null

  const age = now - updatedAt
  if (age < staleAfterMs) return null

  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-1.5 text-xs text-warning',
        className,
      )}
    >
      <CircleAlert className="size-3.5 shrink-0" />
      Last update {formatAge(age)}
    </span>
  )
}
