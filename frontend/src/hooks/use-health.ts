import { useQuery } from '@tanstack/react-query'

type HealthResponse = {
  status: string
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: async (): Promise<HealthResponse> => {
      const response = await fetch(`${import.meta.env.VITE_API_URL ?? ''}/healthz`)
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`)
      }
      return (await response.json()) as HealthResponse
    },
    // Recover quickly after an outage, then go back to a cheap interval.
    refetchInterval: (query) =>
      query.state.status === 'error' ? 2_000 : 10_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    retry: false,
  })
}
