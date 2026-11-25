import { zodResolver } from '@hookform/resolvers/zod'
import { LoaderCircle, LockKeyhole } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { SessionLoader } from '@/components/auth/session-loader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/components/ui/password-input'
import { useAuth } from '@/hooks/use-auth'
import { ApiError } from '@/lib/api'

const loginSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})

type LoginValues = z.infer<typeof loginSchema>

type LoginLocationState = {
  from?: string
}

export function LoginPage() {
  const { user, isLoading, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as LoginLocationState | null)?.from ?? '/'

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  async function onSubmit(values: LoginValues) {
    form.clearErrors('root')
    try {
      await signIn(values.email, values.password)
      navigate(from, { replace: true })
    } catch (error) {
      let message = 'Could not sign in. Try again.'
      if (error instanceof ApiError) {
        message =
          error.status === 429 && error.retryAfter !== undefined
            ? `Too many attempts. Try again in ${error.retryAfter} s.`
            : error.message
      }
      form.setError('root', { message })
    }
  }

  if (isLoading) {
    return <SessionLoader />
  }

  if (user !== null) {
    return <Navigate to={from} replace />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
            <LockKeyhole className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Safelock</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in to continue
            </p>
          </div>
        </div>

        <Card className="py-5">
          <CardContent>
            <form
              noValidate
              className="grid gap-4"
              onSubmit={form.handleSubmit(onSubmit)}
            >
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="admin@example.com"
                  aria-invalid={Boolean(form.formState.errors.email)}
                  {...form.register('email')}
                />
                {form.formState.errors.email ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.email.message}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <PasswordInput
                  id="password"
                  autoComplete="current-password"
                  aria-invalid={Boolean(form.formState.errors.password)}
                  {...form.register('password')}
                />
                {form.formState.errors.password ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.password.message}
                  </p>
                ) : null}
              </div>

              {form.formState.errors.root ? (
                <p className="text-sm text-destructive">
                  {form.formState.errors.root.message}
                </p>
              ) : null}

              <Button
                type="submit"
                className="mt-1 w-full"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" />
                    Signing in
                  </>
                ) : (
                  'Sign in'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
