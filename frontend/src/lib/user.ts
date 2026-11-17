import type { User } from '@/lib/api'

export function userInitials(email: string): string {
  const local = email.split('@')[0] ?? email
  return local.slice(0, 2).toUpperCase() || '?'
}

export function roleLabel(role: User['role']): string {
  return role === 'admin' ? 'Administrator' : 'Operator'
}
