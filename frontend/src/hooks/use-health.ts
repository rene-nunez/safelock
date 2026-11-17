import { useQuery } from '@tanstack/react-query'

type HealthResponse = {
  status: string
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: async (): Promise<HealthResponse> => {
      const response = await fetch('/healthz')
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`)
      }
      return (await response.json()) as HealthResponse
    },
    refetchInterval: 10_000,
    retry: false,
  })
}
