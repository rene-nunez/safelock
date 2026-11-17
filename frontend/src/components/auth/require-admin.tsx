import type { ReactNode } from 'react'

import { ForbiddenPage } from '@/pages/forbidden'
import { useAuth } from '@/hooks/use-auth'

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth()

  if (user?.role !== 'admin') {
    return <ForbiddenPage />
  }

  return <>{children}</>
}
