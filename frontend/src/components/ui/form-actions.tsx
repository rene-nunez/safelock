import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type FormActionsProps = {
  children: ReactNode
  className?: string
}

export function FormActions({ children, className }: FormActionsProps) {
  return (
    <div
      className={cn(
        'flex flex-col flex-wrap gap-2 [&>*]:w-full sm:flex-row sm:items-center sm:justify-end sm:[&>*]:w-auto',
        className,
      )}
    >
      {children}
    </div>
  )
}
