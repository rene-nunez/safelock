export type DeviceLocation = {
  lat: number
  lng: number
}

export type Device = {
  id: string
  name: string
  online: boolean
  locked: boolean
  lock: 'locked' | 'unlocked' | 'open'
  lastSeen: string
  location: DeviceLocation | null
}
