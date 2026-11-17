import { useEffect, useRef, useState } from 'react'
import { LogOut, Menu } from 'lucide-react'
import { Outlet, useLocation } from 'react-router-dom'

import { Sidebar } from '@/components/layout/sidebar'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'
import { useHealth } from '@/hooks/use-health'
import { cn } from '@/lib/utils'
import { roleLabel, userInitials } from '@/lib/user'

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/cardholders': 'Cardholders',
  '/devices': 'Devices',
  '/activity': 'Activity',
  '/audit': 'Audit',
  '/users': 'Users',
}

function ApiStatus() {
  const { data, status, isFetching } = useHealth()
  const online = status === 'success' && data?.status === 'ok'
  const checking = isFetching && !online
  const label = online ? 'Online' : checking ? 'Checking' : 'Offline'

  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
      aria-label={label}
    >
      <span
        className={cn(
          'size-2 rounded-full',
          online
            ? 'bg-emerald-500'
            : checking
              ? 'bg-amber-500'
              : 'bg-red-500',
        )}
      />
      <span className="hidden sm:inline">{label}</span>
    </span>
  )
}

function AccountMenu() {
  const { user, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="grid size-8 place-items-center rounded-full bg-secondary text-xs font-medium"
      >
        {user ? userInitials(user.email) : '?'}
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-medium">
              {user?.email ?? 'Signed out'}
            </p>
            <p className="text-xs text-muted-foreground">
              {user ? roleLabel(user.role) : '—'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              signOut()
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
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
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background px-4 lg:px-6">
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
            <AccountMenu />
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
