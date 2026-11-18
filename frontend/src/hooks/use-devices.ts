import { useQuery } from '@tanstack/react-query'

import { listDevices, type Device } from '@/lib/api'

export type DeviceSummary = {
  total: number
  online: number
  locked: number
}

export function summarizeDevices(devices: Device[] | undefined): DeviceSummary {
  const active = (devices ?? []).filter((device) => device.status === 'active')

  return {
    total: active.length,
    online: active.filter((device) => device.online).length,
    locked: active.filter((device) => device.locked).length,
  }
}

export function useDevices() {
  return useQuery({
    queryKey: ['devices'],
    queryFn: listDevices,
    refetchInterval: 3000,
  })
}
