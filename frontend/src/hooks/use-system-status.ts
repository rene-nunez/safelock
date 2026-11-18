import { useMemo } from 'react'

import { summarizeDevices, useDevices, type DeviceSummary } from '@/hooks/use-devices'
import { useHealth } from '@/hooks/use-health'

export type SystemStatusInfo = {
  apiOnline: boolean
  apiChecking: boolean
  devices: DeviceSummary
}

export function useSystemStatus(): SystemStatusInfo {
  const health = useHealth()
  const devices = useDevices()
  const apiOnline = health.status === 'success' && health.data?.status === 'ok'
  const deviceSummary = useMemo(
    () => summarizeDevices(devices.data),
    [devices.data],
  )

  return {
    apiOnline,
    apiChecking: health.isFetching && !apiOnline,
    devices: deviceSummary,
  }
}
