import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { AppShell } from '@/components/layout/app-shell'
import { DashboardPage } from '@/pages/dashboard'
import { LoginPage } from '@/pages/login'
import { NotFoundPage } from '@/pages/not-found'
import { PlaceholderPage } from '@/pages/placeholder'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
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
              <PlaceholderPage
                title="Audit"
                description="Administrative actions recorded by the backend."
              />
            }
          />
          <Route
            path="users"
            element={
              <PlaceholderPage
                title="Users"
                description="Administrators and operators with access to Safelock."
              />
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
