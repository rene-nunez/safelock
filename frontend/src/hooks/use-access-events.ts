import { useQuery } from '@tanstack/react-query'

import { listAccessEvents, type AccessEventQuery } from '@/lib/api'

export function useAccessEvents(query: AccessEventQuery = {}) {
  const { limit = 50, offset = 0, deviceId } = query
  return useQuery({
    queryKey: ['access-events', { limit, offset, deviceId }],
    queryFn: () => listAccessEvents({ limit, offset, deviceId }),
    refetchInterval: 3000,
  })
}
