import {
  Activity,
  ClipboardList,
  Cpu,
  IdCardLanyard,
  LayoutDashboard,
  Users,
  type LucideIcon,
} from 'lucide-react'

export type NavItem = {
  to: string
  label: string
  description: string
  icon: LucideIcon
  end?: boolean
  adminOnly?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    description: 'System overview and activity.',
    icon: LayoutDashboard,
    end: true,
  },
  {
    to: '/cardholders',
    label: 'Cardholders',
    description: 'Monitor cardholders and access credentials.',
    icon: IdCardLanyard,
  },
  {
    to: '/devices',
    label: 'Devices',
    description: 'Security devices and settings.',
    icon: Cpu,
  },
  {
    to: '/activity',
    label: 'Activity',
    description: 'Access decisions reported by devices.',
    icon: Activity,
  },
  {
    to: '/audit',
    label: 'Audit',
    description: 'Administrative change history.',
    icon: ClipboardList,
    adminOnly: true,
  },
  {
    to: '/users',
    label: 'Users',
    description: 'Accounts and roles.',
    icon: Users,
    adminOnly: true,
  },
]
