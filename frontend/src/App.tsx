import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { AuthProvider } from '@/components/auth/auth-provider'
import { RequireAdmin } from '@/components/auth/require-admin'
import { RequireAuth } from '@/components/auth/require-auth'
import { AppShell } from '@/components/layout/app-shell'
import { ActivityPage } from '@/pages/activity'
import { AuditPage } from '@/pages/audit'
import { CardholdersPage } from '@/pages/cardholders'
import { DashboardPage } from '@/pages/dashboard'
import { DevicesPage } from '@/pages/devices'
import { LoginPage } from '@/pages/login'
import { NotFoundPage } from '@/pages/not-found'
import { UsersPage } from '@/pages/users'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<DashboardPage />} />
              <Route path="cardholders" element={<CardholdersPage />} />
              <Route path="devices" element={<DevicesPage />} />
              <Route path="activity" element={<ActivityPage />} />
              <Route
                path="audit"
                element={
                  <RequireAdmin>
                    <AuditPage />
                  </RequireAdmin>
                }
              />
              <Route
                path="users"
                element={
                  <RequireAdmin>
                    <UsersPage />
                  </RequireAdmin>
                }
              />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
