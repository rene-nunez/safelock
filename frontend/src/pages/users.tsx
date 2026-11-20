import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, UserPlus, X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FormActions } from '@/components/ui/form-actions'
import { FormField } from '@/components/ui/form-field'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Input } from '@/components/ui/input'
import { PageToolbar } from '@/components/ui/page-toolbar'
import { PasswordInput } from '@/components/ui/password-input'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/hooks/use-auth'
import {
  ApiError,
  createUser,
  listUsers,
  updateUser,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type UpdateUserInput,
} from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { roleLabel, userInitials } from '@/lib/user'
import { cn } from '@/lib/utils'

const createUserSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z
    .string()
    .min(
      PASSWORD_MIN_LENGTH,
      `Use at least ${PASSWORD_MIN_LENGTH} characters`,
    )
    .max(
      PASSWORD_MAX_LENGTH,
      `Use at most ${PASSWORD_MAX_LENGTH} characters`,
    ),
  role: z.enum(['admin', 'operator']),
})

const editSchema = z.object({
  role: z.enum(['admin', 'operator']),
  password: z
    .string()
    .refine(
      (value) =>
        value === '' ||
        (value.length >= PASSWORD_MIN_LENGTH &&
          value.length <= PASSWORD_MAX_LENGTH),
      `Use between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`,
    ),
})

type CreateValues = z.infer<typeof createUserSchema>
type EditValues = z.infer<typeof editSchema>
type NoticeArea = 'page' | 'detail'

function errorMessage(error: unknown): string | null {
  if (error === null || error === undefined) return null
  return error instanceof ApiError
    ? error.message
    : 'Something went wrong. Try again.'
}

function updateMessage(input: UpdateUserInput): string {
  if (input.password !== undefined) return 'User updated.'
  if (input.active === true) return 'User activated.'
  if (input.active === false) return 'User deactivated.'
  return 'Role updated.'
}

export function UsersPage() {
  const { user: currentUser } = useAuth()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const [success, setSuccess] = useState<{
    message: string
    area: NoticeArea
  } | null>(null)

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: listUsers,
  })

  const users = usersQuery.data ?? []
  const selected = users.find((item) => item.id === selectedId) ?? null
  const editableUser =
    selected !== null && selected.id !== currentUser?.id ? selected : null

  function showSuccess(message: string, area: NoticeArea = 'page') {
    setSuccess({ message, area })
  }

  const createForm = useForm<CreateValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { email: '', password: '', role: 'operator' },
  })
  const editForm = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { role: 'operator', password: '' },
  })

  const createMutation = useMutation({
    mutationFn: createUser,
    onMutate: () => setSuccess(null),
    onSuccess: (user) => {
      createForm.reset()
      setCreateOpen(false)
      setSelectedId(user.id)
      showSuccess('User added.')
      void queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) =>
      updateUser(id, input),
    onMutate: () => setSuccess(null),
    onSuccess: (user, { input }) => {
      editForm.reset({ role: user.role, password: '' })
      setConfirmDeactivate(false)
      showSuccess(updateMessage(input), 'detail')
      void queryClient.invalidateQueries({ queryKey: ['users'] })
    },
  })

  useEffect(() => {
    editForm.reset({ role: selected?.role ?? 'operator', password: '' })
    setConfirmDeactivate(false)
    updateMutation.reset()
    // Reset only when switching users, not after a background refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  function onCreate(values: CreateValues) {
    createMutation.mutate(values)
  }

  function onSave(values: EditValues) {
    if (!editableUser) return

    const input: UpdateUserInput = { role: values.role }
    if (values.password !== '') input.password = values.password
    updateMutation.mutate({ id: editableUser.id, input })
  }

  function setActive(active: boolean) {
    if (!editableUser) return
    updateMutation.mutate({ id: editableUser.id, input: { active } })
  }

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <PageToolbar>
        <Button
          onClick={() => {
            createMutation.reset()
            setCreateOpen((value) => !value)
          }}
          aria-expanded={createOpen}
        >
          {createOpen ? <X className="size-4" /> : <UserPlus className="size-4" />}
          {createOpen ? 'Close form' : 'Add user'}
        </Button>
      </PageToolbar>

      <InlineNotice
        tone="success"
        message={success?.area === 'page' ? success.message : null}
      />

      {createOpen ? (
        <Card>
          <CardHeader>
            <CardTitle>Add user</CardTitle>
          </CardHeader>
          <CardContent>
            <form noValidate onSubmit={createForm.handleSubmit(onCreate)}>
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField
                  label="Email"
                  htmlFor="new-email"
                  error={createForm.formState.errors.email?.message}
                >
                  <Input
                    type="email"
                    autoComplete="off"
                    placeholder="operator@example.com"
                    {...createForm.register('email')}
                  />
                </FormField>
                <FormField
                  label="Password"
                  htmlFor="new-password"
                  error={createForm.formState.errors.password?.message}
                >
                  <PasswordInput
                    autoComplete="new-password"
                    {...createForm.register('password')}
                  />
                </FormField>
                <FormField label="Role" htmlFor="new-role">
                  <Select id="new-role" {...createForm.register('role')}>
                    <option value="operator">Operator</option>
                    <option value="admin">Administrator</option>
                  </Select>
                </FormField>
              </div>
              <div className="mt-4 border-t border-border pt-4">
                <FormActions>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setCreateOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending}>
                    <UserPlus className="size-4" />
                    {createMutation.isPending ? 'Adding' : 'Add user'}
                  </Button>
                </FormActions>
                <InlineNotice
                  message={errorMessage(createMutation.error)}
                  className="mt-3"
                />
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)] lg:gap-6">
        <Card>
          <CardContent className="flex flex-col px-0">
            <div className="flex items-baseline gap-2 px-6 pb-3">
              <span className="text-2xl font-semibold tabular-nums">
                {users.length}
              </span>
              <span className="text-xs text-muted-foreground">total</span>
            </div>
            <InlineNotice
              message={errorMessage(usersQuery.error)}
              className="mx-6 mb-3"
            />
            {usersQuery.isPending ? (
              <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                Loading users…
              </p>
            ) : users.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                No users yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {users.map((entry) => {
                  const active = selectedId === entry.id
                  const own = entry.id === currentUser?.id

                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        disabled={own}
                        aria-current={active ? 'true' : undefined}
                        onClick={() => {
                          setSuccess(null)
                          setSelectedId(entry.id)
                        }}
                        className={cn(
                          'flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3 text-left transition-colors',
                          own
                            ? 'cursor-default'
                            : 'hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                          active && 'bg-accent',
                        )}
                      >
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-medium">
                          {userInitials(entry.email)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {entry.email}
                          </span>
                          {own ? (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              Current account
                            </span>
                          ) : (
                            <span className="block text-xs text-muted-foreground">
                              {entry.last_login_at
                                ? `Last sign in ${formatDateTime(entry.last_login_at)}`
                                : 'Never signed in'}
                            </span>
                          )}
                        </span>
                        <Badge
                          variant={
                            entry.role === 'admin' ? 'default' : 'secondary'
                          }
                        >
                          {roleLabel(entry.role)}
                        </Badge>
                        <Badge variant={entry.active ? 'success' : 'muted'}>
                          {entry.active ? 'Active' : 'Inactive'}
                        </Badge>
                        {own ? (
                          <span className="size-4 shrink-0" aria-hidden />
                        ) : (
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="truncate">
              {selected ? selected.email : 'Select a user'}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <InlineNotice
              tone="success"
              message={success?.area === 'detail' ? success.message : null}
            />
            <InlineNotice message={errorMessage(updateMutation.error)} />

            {!editableUser ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Select a user from the list.
              </p>
            ) : (
              <form
                noValidate
                className="grid gap-4 sm:grid-cols-2"
                onSubmit={editForm.handleSubmit(onSave)}
              >
                <FormField
                  label="Role"
                  htmlFor="edit-role"
                  error={editForm.formState.errors.role?.message}
                >
                  <Select id="edit-role" {...editForm.register('role')}>
                    <option value="operator">Operator</option>
                    <option value="admin">Administrator</option>
                  </Select>
                </FormField>
                <FormField
                  label="New password"
                  htmlFor="edit-password"
                  error={editForm.formState.errors.password?.message}
                >
                  <PasswordInput
                    id="edit-password"
                    autoComplete="new-password"
                    {...editForm.register('password')}
                  />
                </FormField>
                <FormActions className="sm:col-span-2">
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={
                      updateMutation.isPending || !editForm.formState.isDirty
                    }
                  >
                    Save changes
                  </Button>
                  {confirmDeactivate ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setConfirmDeactivate(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={updateMutation.isPending}
                        onClick={() => setActive(false)}
                      >
                        Confirm deactivation
                      </Button>
                    </>
                  ) : editableUser.active ? (
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={updateMutation.isPending}
                      onClick={() => setConfirmDeactivate(true)}
                    >
                      Deactivate
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={updateMutation.isPending}
                      onClick={() => setActive(true)}
                    >
                      Activate
                    </Button>
                  )}
                </FormActions>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
