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
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          : 'border-red-500/30 bg-red-500/10 text-red-300',
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
