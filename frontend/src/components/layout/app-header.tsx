import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Cpu, Lock, LogOut, Menu, type LucideIcon } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

import { NAV_ITEMS } from '@/components/layout/nav'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'
import {
  type SystemStatusInfo,
  useSystemStatus,
} from '@/hooks/use-system-status'
import { cn } from '@/lib/utils'
import { roleLabel, userInitials } from '@/lib/user'

function PageHeading({ onOpenMenu }: { onOpenMenu: () => void }) {
  const location = useLocation()
  const item = NAV_ITEMS.find((navItem) => navItem.to === location.pathname)
  const Icon: LucideIcon | undefined = item?.icon

  return (
    <div className="flex min-w-0 items-center gap-3">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="Open menu"
        onClick={onOpenMenu}
      >
        <Menu className="size-5" />
      </Button>
      {Icon ? (
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand ring-1 ring-brand/20">
          <Icon className="size-4" />
        </span>
      ) : null}
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">
          {item?.label ?? 'Safelock'}
        </h1>
        {item ? (
          <p className="hidden truncate text-xs text-muted-foreground sm:block">
            {item.description}
          </p>
        ) : null}
      </div>
    </div>
  )
}

type StatusChipProps = {
  title: string
  children: ReactNode
  to?: string
  className?: string
}

function StatusChip({ title, children, to, className }: StatusChipProps) {
  const classes = cn(
    'inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-xs text-muted-foreground sm:px-3',
    to && 'transition-colors hover:bg-accent hover:text-accent-foreground',
    className,
  )

  if (to) {
    return (
      <Link to={to} title={title} aria-label={title} className={classes}>
        {children}
      </Link>
    )
  }

  return (
    <span title={title} className={cn(classes, 'cursor-default select-none')}>
      {children}
    </span>
  )
}

function SystemStatus({ status }: { status: SystemStatusInfo }) {
  const { apiOnline, apiConnecting, devices, devicesLoading } = status
  const apiLabel = apiOnline ? 'Online' : apiConnecting ? 'Connecting…' : 'Offline'
  const onlineValue = devicesLoading
    ? '—'
    : `${devices.online}/${devices.total}`
  const lockedValue = devicesLoading
    ? '—'
    : `${devices.locked}/${devices.total}`
  const devicesTitle = devicesLoading
    ? 'Loading devices…'
    : `${devices.online} of ${devices.total} devices online`
  const lockedTitle = devicesLoading
    ? 'Loading doors…'
    : `${devices.locked} of ${devices.total} doors locked`

  return (
    <>
      <StatusChip title={`System ${apiLabel.toLowerCase()}`}>
        <span
          className={cn(
            'size-2 rounded-full',
            apiOnline
              ? 'bg-brand'
              : apiConnecting
                ? 'bg-amber-500'
                : 'bg-red-500',
          )}
        />
        <span className="hidden sm:inline">{apiLabel}</span>
        <span className="sr-only sm:hidden">{apiLabel}</span>
      </StatusChip>
      <StatusChip
        to="/devices"
        title={devicesTitle}
        className="hidden md:inline-flex"
      >
        <Cpu className="size-3.5" />
        <span className="tabular-nums">{onlineValue}</span>
      </StatusChip>
      <StatusChip
        to="/devices"
        title={lockedTitle}
        className="hidden md:inline-flex"
      >
        <Lock className="size-3.5" />
        <span className="tabular-nums">{lockedValue}</span>
      </StatusChip>
    </>
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
        title={user ? `${user.email} (${roleLabel(user.role)})` : 'Signed out'}
        onClick={() => setOpen((value) => !value)}
        className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-medium ring-1 ring-border transition-all duration-200 hover:bg-zinc-700 hover:text-brand hover:ring-2 hover:ring-brand/40 hover:shadow-md"
      >
        {user ? userInitials(user.email) : '?'}
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
          <div className="px-2 py-2">
            <p className="truncate text-sm font-medium">
              {user?.email ?? 'Signed out'}
            </p>
            {user ? (
              <span className="mt-2 inline-flex rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand">
                {roleLabel(user.role)}
              </span>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">—</p>
            )}
          </div>
          <div className="my-1 h-px bg-border" />
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

export function AppHeader({ onOpenMenu }: { onOpenMenu: () => void }) {
  const status = useSystemStatus()

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-zinc-950">
      <div className="flex h-16 items-center gap-3 px-4 lg:px-6">
        <PageHeading onOpenMenu={onOpenMenu} />
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <SystemStatus status={status} />
          <AccountMenu />
        </div>
      </div>
      {/* Inside the sticky header so it stays visible while scrolling. Hidden only
          until the first health response; it stays mounted during retries. */}
      {!status.apiOnline && !status.apiConnecting ? (
        <div
          role="status"
          className="border-t border-border bg-secondary px-4 py-2 text-center text-xs text-foreground/90 lg:px-6"
        >
          Connection lost. Trying to reconnect…
        </div>
      ) : null}
    </header>
  )
}
