import {
  Activity,
  ClipboardList,
  Contact,
  Cpu,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Users,
} from 'lucide-react'
import { Link, NavLink } from 'react-router-dom'

import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'
import { roleLabel, userInitials } from '@/lib/user'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/cardholders', label: 'Cardholders', icon: Contact },
  { to: '/devices', label: 'Devices', icon: Cpu },
  { to: '/activity', label: 'Activity', icon: Activity },
  { to: '/audit', label: 'Audit', icon: ClipboardList, adminOnly: true },
  { to: '/users', label: 'Users', icon: Users, adminOnly: true },
]

type SidebarProps = {
  onNavigate?: () => void
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const { user, signOut } = useAuth()
  const items = NAV_ITEMS.filter(
    (item) => !item.adminOnly || user?.role === 'admin',
  )

  return (
    <div className="flex h-full flex-col gap-6 px-3 py-4">
      <Link
        to="/"
        className="flex items-center gap-2.5 px-2"
        onClick={onNavigate}
      >
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <LockKeyhole className="size-4" />
        </span>
        <span className="text-base font-semibold tracking-tight">Safelock</span>
      </Link>

      <nav className="flex flex-1 flex-col gap-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                isActive && 'bg-accent text-accent-foreground',
              )
            }
          >
            <item.icon className="size-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border pt-3">
        <div className="flex items-center gap-2.5 px-2 pb-3">
          <span className="grid size-8 place-items-center rounded-full bg-secondary text-xs font-medium">
            {user ? userInitials(user.email) : '?'}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">
              {user?.email ?? 'Signed out'}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {user ? roleLabel(user.role) : '—'}
            </span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            signOut()
            onNavigate?.()
          }}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <LogOut className="size-4" />
          Sign out
        </button>
      </div>
    </div>
  )
}
