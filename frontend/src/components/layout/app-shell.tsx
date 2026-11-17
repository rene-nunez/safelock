import { useState } from 'react'
import { Menu } from 'lucide-react'
import { Outlet, useLocation } from 'react-router-dom'

import { Sidebar } from '@/components/layout/sidebar'
import { Button } from '@/components/ui/button'
import { useHealth } from '@/hooks/use-health'
import { cn } from '@/lib/utils'

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/cardholders': 'Cardholders',
  '/devices': 'Devices',
  '/activity': 'Activity',
  '/audit': 'Audit',
  '/users': 'Users',
}

function ApiStatus() {
  const { status } = useHealth()
  const online = status === 'success'

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
      <span
        className={cn(
          'size-2 rounded-full',
          online
            ? 'bg-emerald-500'
            : status === 'pending'
              ? 'bg-amber-500'
              : 'bg-red-500',
        )}
      />
      {online ? 'API online' : status === 'pending' ? 'Checking API' : 'API offline'}
    </span>
  )
}

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const title = PAGE_TITLES[location.pathname] ?? 'Safelock'

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
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="size-5" />
          </Button>
          <h1 className="text-sm font-medium">{title}</h1>
          <div className="ml-auto flex items-center gap-3">
            <ApiStatus />
            <span className="hidden size-8 place-items-center rounded-full bg-secondary text-xs font-medium sm:grid">
              AD
            </span>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
