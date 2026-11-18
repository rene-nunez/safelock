import { useState } from 'react'
import { Outlet } from 'react-router-dom'

import { AppHeader } from '@/components/layout/app-header'
import { Sidebar } from '@/components/layout/sidebar'

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-border bg-zinc-950/60 lg:block">
        <Sidebar />
      </aside>

      {menuOpen ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-60 border-r border-border bg-zinc-950 lg:hidden">
            <Sidebar onNavigate={() => setMenuOpen(false)} />
          </aside>
        </>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader onOpenMenu={() => setMenuOpen(true)} />

        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
