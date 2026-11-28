import { CircleAlert, CircleCheck } from 'lucide-react'

import { cn } from '@/lib/utils'

type InlineNoticeProps = {
  message: string | null | undefined
  tone?: 'success' | 'error'
  compact?: boolean
  className?: string
}

export function InlineNotice({
  message,
  tone = 'error',
  compact = false,
  className,
}: InlineNoticeProps) {
  if (!message) return null

  const success = tone === 'success'

  return (
    <p
      role={success ? 'status' : 'alert'}
      className={cn(
        'flex items-start rounded-md border px-3 py-2 text-sm',
        compact ? 'gap-1.5 px-2 py-1.5 text-xs' : 'gap-2',
        success
          ? 'border-success/30 bg-success/10 text-success'
          : 'border-destructive/30 bg-destructive/10 text-destructive',
        className,
      )}
    >
      {success ? (
        <CircleCheck
          className={cn('mt-0.5 shrink-0', compact ? 'size-3.5' : 'size-4')}
        />
      ) : (
        <CircleAlert
          className={cn('mt-0.5 shrink-0', compact ? 'size-3.5' : 'size-4')}
        />
      )}
      <span>{message}</span>
    </p>
  )
}
