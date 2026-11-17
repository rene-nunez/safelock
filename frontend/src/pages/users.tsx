import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/hooks/use-auth'
import {
  ApiError,
  createUser,
  listUsers,
  updateUser,
  PASSWORD_MIN_LENGTH,
  type UpdateUserInput,
} from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { roleLabel, userInitials } from '@/lib/user'

const createUserSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z
    .string()
    .min(
      PASSWORD_MIN_LENGTH,
      `Use at least ${PASSWORD_MIN_LENGTH} characters`,
    ),
  role: z.enum(['admin', 'operator']),
})

type CreateUserValues = z.infer<typeof createUserSchema>

function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'Something went wrong. Try again.'
}

export function UsersPage() {
  const { user: currentUser } = useAuth()
  const queryClient = useQueryClient()

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: listUsers,
  })

  const form = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { email: '', password: '', role: 'operator' },
  })

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: async () => {
      form.reset()
      await queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) =>
      updateUser(id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })

  function onCreate(values: CreateUserValues) {
    createMutation.mutate(values)
  }

  const users = usersQuery.data ?? []

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Add user</CardTitle>
          <CardDescription>
            New accounts start as operators. Promote them to administrators
            only when they need to manage devices or users.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            className="grid gap-4 lg:grid-cols-[1.4fr_1.4fr_0.8fr_auto] lg:items-start"
            onSubmit={form.handleSubmit(onCreate)}
          >
            <div className="grid gap-2">
              <Label htmlFor="new-email">Email</Label>
              <Input
                id="new-email"
                type="email"
                autoComplete="off"
                placeholder="operator@example.com"
                aria-invalid={Boolean(form.formState.errors.email)}
                {...form.register('email')}
              />
              {form.formState.errors.email ? (
                <p className="text-xs text-red-400">
                  {form.formState.errors.email.message}
                </p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="new-password">Password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(form.formState.errors.password)}
                {...form.register('password')}
              />
              {form.formState.errors.password ? (
                <p className="text-xs text-red-400">
                  {form.formState.errors.password.message}
                </p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="new-role">Role</Label>
              <Select id="new-role" {...form.register('role')}>
                <option value="operator">Operator</option>
                <option value="admin">Administrator</option>
              </Select>
            </div>

            <Button
              type="submit"
              className="lg:mt-7"
              disabled={createMutation.isPending}
            >
              <UserPlus className="size-4" />
              {createMutation.isPending ? 'Adding' : 'Add user'}
            </Button>
          </form>

          {createMutation.error ? (
            <p className="mt-3 text-sm text-red-400">
              {errorMessage(createMutation.error)}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Users</CardTitle>
            <CardDescription>
              Administrators and operators with access to Safelock.
            </CardDescription>
          </div>
          <Badge variant="outline">{users.length} accounts</Badge>
        </CardHeader>
        <CardContent className="px-0">
          {updateMutation.error ? (
            <p className="mb-3 px-6 text-sm text-red-400">
              {errorMessage(updateMutation.error)}
            </p>
          ) : null}

          {usersQuery.isPending ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              Loading users…
            </p>
          ) : usersQuery.isError ? (
            <p className="px-6 py-10 text-center text-sm text-red-400">
              {errorMessage(usersQuery.error)}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-y border-border text-left text-xs text-muted-foreground">
                    <th className="px-6 py-2 font-medium">User</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Last sign in</th>
                    <th className="px-6 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => {
                    const isSelf = user.id === currentUser?.id

                    return (
                      <tr
                        key={user.id}
                        className="border-b border-border/60 last:border-0"
                      >
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-medium">
                              {userInitials(user.email)}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-medium">{user.email}</p>
                              {isSelf ? (
                                <p className="text-xs text-muted-foreground">
                                  You
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <Badge
                            variant={user.role === 'admin' ? 'default' : 'secondary'}
                          >
                            {roleLabel(user.role)}
                          </Badge>
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant={user.active ? 'success' : 'muted'}>
                            {user.active ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {user.last_login_at
                            ? formatDateTime(user.last_login_at)
                            : 'Never'}
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isSelf || updateMutation.isPending}
                              title={
                                isSelf
                                  ? 'You cannot change your own role'
                                  : undefined
                              }
                              onClick={() =>
                                updateMutation.mutate({
                                  id: user.id,
                                  input: {
                                    role:
                                      user.role === 'admin'
                                        ? 'operator'
                                        : 'admin',
                                  },
                                })
                              }
                            >
                              {user.role === 'admin' ? 'Make operator' : 'Make admin'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isSelf || updateMutation.isPending}
                              title={
                                isSelf
                                  ? 'You cannot deactivate your own account'
                                  : undefined
                              }
                              onClick={() =>
                                updateMutation.mutate({
                                  id: user.id,
                                  input: { active: !user.active },
                                })
                              }
                            >
                              {user.active ? 'Deactivate' : 'Activate'}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
