import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { AuthProvider } from '@/components/auth/auth-provider'
import { RequireAdmin } from '@/components/auth/require-admin'
import { RequireAuth } from '@/components/auth/require-auth'
import { AppShell } from '@/components/layout/app-shell'
import { DashboardPage } from '@/pages/dashboard'
import { LoginPage } from '@/pages/login'
import { NotFoundPage } from '@/pages/not-found'
import { PlaceholderPage } from '@/pages/placeholder'
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
              <Route
                path="cardholders"
                element={
                  <PlaceholderPage
                    title="Cardholders"
                    description="Manage the people who can hold credentials."
                  />
                }
              />
              <Route
                path="devices"
                element={
                  <PlaceholderPage
                    title="Devices"
                    description="Register locks, set their location and review their state."
                  />
                }
              />
              <Route
                path="activity"
                element={
                  <PlaceholderPage
                    title="Activity"
                    description="Every access decision reported by the devices."
                  />
                }
              />
              <Route
                path="audit"
                element={
                  <RequireAdmin>
                    <PlaceholderPage
                      title="Audit"
                      description="Administrative actions recorded by the backend."
                    />
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
