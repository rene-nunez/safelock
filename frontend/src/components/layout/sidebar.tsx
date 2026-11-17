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

import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/cardholders', label: 'Cardholders', icon: Contact },
  { to: '/devices', label: 'Devices', icon: Cpu },
  { to: '/activity', label: 'Activity', icon: Activity },
  { to: '/audit', label: 'Audit', icon: ClipboardList },
  { to: '/users', label: 'Users', icon: Users },
]

type SidebarProps = {
  onNavigate?: () => void
}

export function Sidebar({ onNavigate }: SidebarProps) {
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
        {NAV_ITEMS.map((item) => (
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
            AD
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">admin</span>
            <span className="block truncate text-xs text-muted-foreground">
              Administrator
            </span>
          </span>
        </div>
        <Link
          to="/login"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <LogOut className="size-4" />
          Sign out
        </Link>
      </div>
    </div>
  )
}
