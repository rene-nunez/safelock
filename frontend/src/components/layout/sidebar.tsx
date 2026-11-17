import {
  Activity,
  ClipboardList,
  Contact,
  Cpu,
  LayoutDashboard,
  LockKeyhole,
  Users,
} from 'lucide-react'
import { Link, NavLink } from 'react-router-dom'

import { useAuth } from '@/hooks/use-auth'
import { cn } from '@/lib/utils'

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
  const { user } = useAuth()
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
    </div>
  )
}
