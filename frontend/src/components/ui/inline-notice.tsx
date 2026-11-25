import { CircleAlert, CircleCheck } from 'lucide-react'

import { cn } from '@/lib/utils'

type InlineNoticeProps = {
  message: string | null | undefined
  tone?: 'success' | 'error'
  className?: string
}

export function InlineNotice({
  message,
  tone = 'error',
  className,
}: InlineNoticeProps) {
  if (!message) return null

  const success = tone === 'success'

  return (
    <p
      role={success ? 'status' : 'alert'}
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
        success
          ? 'border-success/30 bg-success/10 text-success'
          : 'border-destructive/30 bg-destructive/10 text-destructive',
        className,
      )}
    >
      {success ? (
        <CircleCheck className="mt-0.5 size-4 shrink-0" />
      ) : (
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
      )}
      <span>{message}</span>
    </p>
  )
}
