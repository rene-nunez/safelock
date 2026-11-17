import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { SessionLoader } from '@/components/auth/session-loader'
import { useAuth } from '@/hooks/use-auth'

export function RequireAuth() {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return <SessionLoader />
  }

  if (user === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}
