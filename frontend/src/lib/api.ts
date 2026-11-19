import { getToken } from '@/lib/token'

const API_PREFIX = '/api/v1'
export const UNAUTHORIZED_EVENT = 'safelock:unauthorized'

export type Role = 'admin' | 'operator'

export type User = {
  id: string
  email: string
  role: Role
  active: boolean
  last_login_at: string | null
}

export type TokenResponse = {
  access_token: string
  token_type: 'bearer'
  expires_in: number
}

export type CardholderStatus = 'active' | 'inactive'

export type Cardholder = {
  id: string
  name: string
  email: string | null
  unit: string | null
  status: CardholderStatus
  created_at: string
  updated_at: string
}

export type CredentialStatus = 'active' | 'revoked'

export type Credential = {
  id: string
  holder_id: string
  uid: string
  status: CredentialStatus
  valid_from: string | null
  valid_to: string | null
  revoked_at: string | null
  has_pin: boolean
  pin_locked_until: string | null
  created_at: string
  updated_at: string
}

export type OfflinePolicy = 'allow' | 'deny'
export type DeviceStatus = 'active' | 'retired'

export type Device = {
  id: string
  device_id: string
  name: string
  site: string | null
  fw: string | null
  online: boolean
  last_seen: string | null
  acl_version: number
  last_sync_at: string | null
  offline_policy: OfflinePolicy
  stale_acl_hours: number
  unlock_ms: number
  requires_pin: boolean
  locked: boolean
  lock: 'locked' | 'unlocked' | null
  status: DeviceStatus
  location: DeviceLocation | null
  created_at: string
  updated_at: string
}

export type DeviceLocation = {
  lat: number
  lng: number
}

export type AuditLog = {
  id: string
  actor_id: string | null
  action: string
  target: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  ip: string | null
  ts: string
}

export type AuditLogPage = {
  items: AuditLog[]
  total: number
  limit: number
  offset: number
}

export type AccessDecision = 'granted' | 'denied' | 'unknown'
export type AccessSource = 'card' | 'pin' | 'remote' | 'manual'

export type AccessEvent = {
  id: string
  device_id: string
  ts: string
  uid: string | null
  credential_id: string | null
  decision: AccessDecision
  reason: string
  source: AccessSource
  acl_version: number | null
  acl_age_s: number | null
  degraded: boolean
  created_at: string
}

export type AccessEventPage = {
  items: AccessEvent[]
  total: number
  today_count: number
  limit: number
  offset: number
}

export type AccessEventQuery = {
  limit?: number
  offset?: number
  deviceId?: string
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type ErrorBody = {
  detail?: unknown
}

async function readErrorDetail(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as ErrorBody
    if (typeof body.detail === 'string') return body.detail
    if (Array.isArray(body.detail)) return 'The request contains invalid fields'
    return null
  } catch {
    return null
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  const token = getToken()
  if (token !== null) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  let response: Response
  try {
    response = await fetch(`${API_PREFIX}${path}`, { ...init, headers })
  } catch {
    throw new ApiError('Cannot reach the API. Is the backend running?', 0)
  }

  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    const detail = await readErrorDetail(response)
    const fallback =
      response.status === 502
        ? 'Backend unavailable. Try again shortly.'
        : response.statusText
    throw new ApiError(detail ?? fallback, response.status)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

export function signIn(email: string, password: string): Promise<TokenResponse> {
  return request<TokenResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export function getCurrentUser(): Promise<User> {
  return request<User>('/auth/me')
}

export type CreateUserInput = {
  email: string
  password: string
  role?: Role
}

export type UpdateUserInput = {
  role?: Role
  active?: boolean
  password?: string
}

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 256

export function listUsers(): Promise<User[]> {
  return request<User[]>('/users')
}

export function createUser(input: CreateUserInput): Promise<User> {
  return request<User>('/users', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateUser(id: string, input: UpdateUserInput): Promise<User> {
  return request<User>(`/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export type CreateCardholderInput = {
  name: string
  email?: string | null
  unit?: string | null
}

export type UpdateCardholderInput = Partial<CreateCardholderInput> & {
  status?: CardholderStatus
}

export function listCardholders(): Promise<Cardholder[]> {
  return request<Cardholder[]>('/cardholders')
}

export function createCardholder(
  input: CreateCardholderInput,
): Promise<Cardholder> {
  return request<Cardholder>('/cardholders', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateCardholder(
  id: string,
  input: UpdateCardholderInput,
): Promise<Cardholder> {
  return request<Cardholder>(`/cardholders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function activateAndRestoreCardholder(id: string): Promise<Cardholder> {
  return request<Cardholder>(`/cardholders/${id}/activate-and-restore`, {
    method: 'POST',
  })
}

export function deleteCardholder(id: string): Promise<void> {
  return request<void>(`/cardholders/${id}`, { method: 'DELETE' })
}

export type CreateCredentialInput = {
  uid: string
  valid_from?: string | null
  valid_to?: string | null
  pin?: string
}

export type UpdateCredentialInput = {
  valid_from?: string | null
  valid_to?: string | null
  pin?: string
  clear_pin?: boolean
}

export function listHolderCredentials(holderId: string): Promise<Credential[]> {
  return request<Credential[]>(`/cardholders/${holderId}/credentials`)
}

export function createCredential(
  holderId: string,
  input: CreateCredentialInput,
): Promise<Credential> {
  return request<Credential>(`/cardholders/${holderId}/credentials`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateCredential(
  id: string,
  input: UpdateCredentialInput,
): Promise<Credential> {
  return request<Credential>(`/credentials/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function revokeCredential(id: string): Promise<Credential> {
  return request<Credential>(`/credentials/${id}/revoke`, { method: 'POST' })
}

export function restoreCredential(id: string): Promise<Credential> {
  return request<Credential>(`/credentials/${id}/restore`, { method: 'POST' })
}

export function revokeAllCredentials(holderId: string): Promise<Credential[]> {
  return request<Credential[]>(
    `/cardholders/${holderId}/credentials/revoke-all`,
    { method: 'POST' },
  )
}

export function deleteCredential(id: string): Promise<void> {
  return request<void>(`/credentials/${id}`, { method: 'DELETE' })
}

export type CreateDeviceInput = {
  device_id: string
  name: string
  site?: string | null
  location?: DeviceLocation | null
  offline_policy?: OfflinePolicy
  stale_acl_hours?: number
  unlock_ms?: number
  requires_pin?: boolean
}

export type UpdateDeviceInput = {
  name?: string
  site?: string | null
  location?: DeviceLocation | null
  offline_policy?: OfflinePolicy
  stale_acl_hours?: number
  unlock_ms?: number
  requires_pin?: boolean
  locked?: boolean
  status?: DeviceStatus
}

export function listDevices(): Promise<Device[]> {
  return request<Device[]>('/devices')
}

export function createDevice(input: CreateDeviceInput): Promise<Device> {
  return request<Device>('/devices', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateDevice(
  id: string,
  input: UpdateDeviceInput,
): Promise<Device> {
  return request<Device>(`/devices/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function deleteDevice(id: string): Promise<void> {
  return request<void>(`/devices/${id}`, { method: 'DELETE' })
}

export function listAccessEvents(
  query: AccessEventQuery = {},
): Promise<AccessEventPage> {
  const params = new URLSearchParams()
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.offset !== undefined) params.set('offset', String(query.offset))
  if (query.deviceId) params.set('device_id', query.deviceId)
  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  return request<AccessEventPage>(`/access-events${suffix}`)
}

export type AuditLogQuery = {
  limit?: number
  offset?: number
  action?: string
}

export function listAuditLogs(query: AuditLogQuery = {}): Promise<AuditLogPage> {
  const params = new URLSearchParams()
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.offset !== undefined) params.set('offset', String(query.offset))
  if (query.action) params.set('action', query.action)
  const suffix = params.size > 0 ? `?${params.toString()}` : ''
  return request<AuditLogPage>(`/audit-logs${suffix}`)
}
