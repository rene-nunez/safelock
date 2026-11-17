import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, getCurrentUser, signIn as signInRequest } from '@/lib/api'
import { AuthContext } from '@/lib/auth-context'
import { clearToken, getToken, setToken } from '@/lib/token'

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [token, setTokenState] = useState<string | null>(() => getToken())

  const fetchCurrentUser = useCallback(async () => {
    try {
      return await getCurrentUser()
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearToken()
      }
      throw error
    }
  }, [])

  const currentUser = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: fetchCurrentUser,
    enabled: token !== null,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  })

  const signIn = useCallback(
    async (email: string, password: string) => {
      const session = await signInRequest(email, password)
      setToken(session.access_token)
      setTokenState(session.access_token)
      queryClient.removeQueries({ queryKey: ['auth', 'me'] })

      try {
        await queryClient.fetchQuery({
          queryKey: ['auth', 'me'],
          queryFn: fetchCurrentUser,
          staleTime: Infinity,
        })
      } catch (error) {
        clearToken()
        setTokenState(null)
        throw error
      }
    },
    [fetchCurrentUser, queryClient],
  )

  const signOut = useCallback(() => {
    clearToken()
    setTokenState(null)
    queryClient.clear()
  }, [queryClient])

  const value = useMemo(
    () => ({
      user: currentUser.data ?? null,
      isLoading: token !== null && currentUser.isPending,
      signIn,
      signOut,
    }),
    [currentUser.data, currentUser.isPending, token, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
