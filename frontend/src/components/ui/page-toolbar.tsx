import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type PageToolbarProps = {
  children: ReactNode
  className?: string
}

export function PageToolbar({ children, className }: PageToolbarProps) {
  return (
    <div className={cn('flex flex-wrap items-center justify-end gap-2', className)}>
      {children}
    </div>
  )
}
