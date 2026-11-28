import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

type FreshnessProps = {
  updatedAt?: number
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

export function Freshness({ updatedAt, className }: FreshnessProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <span
      className={cn(
        'text-xs tabular-nums text-muted-foreground',
        className,
      )}
    >
      {updatedAt ? `Updated ${formatAge(now - updatedAt)}` : 'Updating…'}
    </span>
  )
}
