import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, KeyRound, Plus, UserPlus, X } from 'lucide-react'
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
import { useAuth } from '@/hooks/use-auth'
import {
  ApiError,
  activateAndRestoreCardholder,
  createCardholder,
  createCredential,
  deleteCardholder,
  deleteCredential,
  listCardholders,
  listHolderCredentials,
  restoreCredential,
  revokeAllCredentials,
  revokeCredential,
  updateCardholder,
  updateCredential,
  type Cardholder,
  type Credential,
  type CreateCredentialInput,
  type UpdateCardholderInput,
} from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const createSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name'),
  email: z
    .string()
    .trim()
    .refine((value) => value === '' || z.email().safeParse(value).success, {
      message: 'Enter a valid email address',
    }),
  unit: z.string().trim(),
})

const editSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name'),
  email: z
    .string()
    .trim()
    .refine((value) => value === '' || z.email().safeParse(value).success, {
      message: 'Enter a valid email address',
    }),
  unit: z.string().trim(),
})

const credentialSchema = z.object({
  uid: z.string().trim().min(1, 'Enter the card UID'),
  pin: z
    .string()
    .trim()
    .refine((value) => value === '' || /^\d{6,32}$/.test(value), {
      message: 'Use 6 to 32 digits',
    }),
  valid_from: z.string(),
  valid_to: z.string(),
})

type CreateValues = z.infer<typeof createSchema>
type EditValues = z.infer<typeof editSchema>
type CredentialValues = z.infer<typeof credentialSchema>
type CredentialAction = 'revoke' | 'restore' | 'delete'
type NoticeArea = 'page' | 'detail' | 'credentials'

const CREDENTIAL_MESSAGES: Record<CredentialAction, string> = {
  revoke: 'Credential revoked.',
  restore: 'Credential restored.',
  delete: 'Credential deleted.',
}

function errorMessage(error: unknown): string | null {
  if (error === null || error === undefined) return null
  return error instanceof ApiError
    ? error.message
    : 'Something went wrong. Try again.'
}

function toIso(value: string): string | null {
  return value === '' ? null : new Date(value).toISOString()
}

function validityLabel(credential: Credential): string {
  const parts: string[] = []
  if (credential.valid_from) {
    parts.push(`From ${formatDateTime(credential.valid_from)}`)
  }
  if (credential.valid_to) {
    parts.push(`Until ${formatDateTime(credential.valid_to)}`)
  }
  return parts.length > 0 ? parts.join(' · ') : 'No validity dates'
}

export function CardholdersPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [credentialOpen, setCredentialOpen] = useState(false)
  const [pinTarget, setPinTarget] = useState<Credential | null>(null)
  const [pinValue, setPinValue] = useState('')
  const [success, setSuccess] = useState<{
    message: string
    area: NoticeArea
  } | null>(null)

  function showSuccess(message: string, area: NoticeArea = 'page') {
    setSuccess({ message, area })
  }

  function resetEditForm(holder: Cardholder) {
    editForm.reset({
      name: holder.name,
      email: holder.email ?? '',
      unit: holder.unit ?? '',
    })
  }

  function closeDetail() {
    setSuccess(null)
    resetPanelMutations()
    editForm.reset()
    setCredentialOpen(false)
    setPinTarget(null)
    setSelectedId(null)
  }

  const cardholdersQuery = useQuery({
    queryKey: ['cardholders'],
    queryFn: listCardholders,
  })
  const cardholders = cardholdersQuery.data ?? []
  const selected = cardholders.find((item) => item.id === selectedId) ?? null

  const credentialsQuery = useQuery({
    queryKey: ['cardholders', selectedId, 'credentials'],
    queryFn: () => listHolderCredentials(selectedId ?? ''),
    enabled: selectedId !== null,
  })
  const credentials = credentialsQuery.data ?? []

  const invalidateCardholders = () =>
    queryClient.invalidateQueries({ queryKey: ['cardholders'], exact: true })
  const invalidateCredentials = () =>
    queryClient.invalidateQueries({
      queryKey: ['cardholders', selectedId, 'credentials'],
    })

  const createForm = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '', email: '', unit: '' },
  })
  const editForm = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: '', email: '', unit: '' },
  })
  const credentialForm = useForm<CredentialValues>({
    resolver: zodResolver(credentialSchema),
    defaultValues: { uid: '', pin: '', valid_from: '', valid_to: '' },
  })

  useEffect(() => {
    resetPanelMutations()
    if (!selected) return
    resetEditForm(selected)
    setCredentialOpen(false)
    setPinTarget(null)
    // Reset only when switching cardholders, not after a background refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  const createMutation = useMutation({
    mutationFn: createCardholder,
    onMutate: () => setSuccess(null),
    onSuccess: (cardholder) => {
      createForm.reset()
      setCreateOpen(false)
      setSelectedId(cardholder.id)
      showSuccess('Cardholder added.')
      void invalidateCardholders()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: UpdateCardholderInput
    }) => updateCardholder(id, input),
    onMutate: () => {
      setSuccess(null)
      resetDetailMutations('update')
    },
    onSuccess: (updated) => {
      showSuccess('Cardholder updated.', 'detail')
      resetEditForm(updated)
      void invalidateCardholders()
      void invalidateCredentials()
    },
  })

  const activateRestoreMutation = useMutation({
    mutationFn: activateAndRestoreCardholder,
    onMutate: () => {
      setSuccess(null)
      resetDetailMutations('activate')
    },
    onSuccess: () => {
      showSuccess('Cardholder activated and cards restored.', 'detail')
      void invalidateCardholders()
      void invalidateCredentials()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteCardholder,
    onMutate: () => {
      setSuccess(null)
      resetDetailMutations('delete')
    },
    onSuccess: () => {
      setSelectedId(null)
      showSuccess('Cardholder deleted.')
      void invalidateCardholders()
    },
  })

  const createCredentialMutation = useMutation({
    mutationFn: (input: CreateCredentialInput) =>
      createCredential(selectedId ?? '', input),
    onMutate: () => setSuccess(null),
    onSuccess: () => {
      credentialForm.reset()
      setCredentialOpen(false)
      showSuccess('Card added.', 'credentials')
      void invalidateCredentials()
    },
  })

  const credentialMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: CredentialAction }) => {
      if (action === 'delete') {
        await deleteCredential(id)
      } else if (action === 'restore') {
        await restoreCredential(id)
      } else {
        await revokeCredential(id)
      }
    },
    onMutate: () => {
      setSuccess(null)
      resetCredentialMutations('credential')
    },
    onSuccess: (_credential, { action }) => {
      showSuccess(CREDENTIAL_MESSAGES[action], 'credentials')
      void invalidateCredentials()
    },
  })

  const revokeAllMutation = useMutation({
    mutationFn: () => revokeAllCredentials(selectedId ?? ''),
    onMutate: () => {
      setSuccess(null)
      resetCredentialMutations('revokeAll')
    },
    onSuccess: () => {
      showSuccess('All active credentials revoked.', 'credentials')
      void invalidateCredentials()
    },
  })

  const pinMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: { pin: string } | { clear_pin: true }
    }) => updateCredential(id, input),
    onMutate: () => setSuccess(null),
    onSuccess: (_credential, { input }) => {
      setPinTarget(null)
      setPinValue('')
      showSuccess(
        'clear_pin' in input ? 'PIN removed.' : 'PIN updated.',
        'credentials',
      )
      void invalidateCredentials()
    },
  })

  function resetDetailMutations(skip?: 'update' | 'activate' | 'delete') {
    if (skip !== 'update') updateMutation.reset()
    if (skip !== 'activate') activateRestoreMutation.reset()
    if (skip !== 'delete') deleteMutation.reset()
  }

  function resetCredentialMutations(skip?: 'credential' | 'revokeAll') {
    if (skip !== 'credential') credentialMutation.reset()
    if (skip !== 'revokeAll') revokeAllMutation.reset()
  }

  function resetPanelMutations() {
    resetDetailMutations()
    resetCredentialMutations()
    pinMutation.reset()
    createCredentialMutation.reset()
  }

  function onCreate(values: CreateValues) {
    createMutation.mutate({
      name: values.name,
      email: values.email === '' ? null : values.email,
      unit: values.unit === '' ? null : values.unit,
    })
  }

  function onEdit(values: EditValues) {
    if (!selected) return
    updateMutation.mutate({
      id: selected.id,
      input: {
        name: values.name,
        email: values.email === '' ? null : values.email,
        unit: values.unit === '' ? null : values.unit,
      },
    })
  }

  function onAddCredential(values: CredentialValues) {
    createCredentialMutation.mutate({
      uid: values.uid,
      pin: values.pin === '' ? undefined : values.pin,
      valid_from: toIso(values.valid_from),
      valid_to: toIso(values.valid_to),
    })
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
          {createOpen ? 'Close form' : 'Add cardholder'}
        </Button>
      </PageToolbar>

      <InlineNotice
        tone="success"
        message={success?.area === 'page' ? success.message : null}
      />

      {createOpen ? (
        <Card>
          <CardHeader>
            <CardTitle>Add cardholder</CardTitle>
          </CardHeader>
          <CardContent>
            <form noValidate onSubmit={createForm.handleSubmit(onCreate)}>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <FormField
                  label="Name"
                  htmlFor="holder-name"
                  error={createForm.formState.errors.name?.message}
                >
                  <Input
                    placeholder="Ada Lovelace"
                    {...createForm.register('name')}
                  />
                </FormField>
                <FormField
                  label="Email (optional)"
                  htmlFor="holder-email"
                  error={createForm.formState.errors.email?.message}
                >
                  <Input
                    type="email"
                    autoComplete="off"
                    placeholder="ada@example.com"
                    {...createForm.register('email')}
                  />
                </FormField>
                <FormField label="Unit (optional)" htmlFor="holder-unit">
                  <Input
                    placeholder="Engineering"
                    {...createForm.register('unit')}
                  />
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
                    {createMutation.isPending ? 'Adding…' : 'Add cardholder'}
                  </Button>
                </FormActions>
              </div>
            </form>
            <InlineNotice
              message={errorMessage(createMutation.error)}
              className="mt-3"
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:gap-6">
        <Card>
          <CardContent className="flex flex-col px-0">
            <div className="flex items-baseline gap-2 px-6 pb-3">
              <span className="text-2xl font-semibold tabular-nums">
                {cardholders.length}
              </span>
              <span className="text-xs text-muted-foreground">total</span>
            </div>
            <InlineNotice
              message={errorMessage(cardholdersQuery.error)}
              className="mx-6 mb-3"
            />
            {cardholdersQuery.isPending ? (
              <p className="flex items-center justify-center px-6 py-10 text-center text-sm text-muted-foreground">
                Loading cardholders…
              </p>
            ) : cardholders.length === 0 ? (
              <p className="flex items-center justify-center px-6 py-10 text-center text-sm text-muted-foreground">
                No cardholders yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {cardholders.map((cardholder) => {
                  const active = selectedId === cardholder.id
                  return (
                    <li key={cardholder.id}>
                      <button
                        type="button"
                        aria-current={active ? 'true' : undefined}
                        onClick={() => {
                          setSuccess(null)
                          setSelectedId(cardholder.id)
                        }}
                        className={cn(
                          'flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                          active && 'bg-accent',
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{cardholder.name}</p>
                        </div>
                        <Badge
                          variant={
                            cardholder.status === 'active' ? 'success' : 'muted'
                          }
                        >
                          {cardholder.status}
                        </Badge>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4">
            <CardTitle className="min-w-0 flex-1 break-words leading-snug">
              {selected ? selected.name : 'Select a cardholder'}
            </CardTitle>
            {selected ? (
              <Button
                className="shrink-0"
                variant="ghost"
                size="icon"
                aria-label="Close details"
                onClick={closeDetail}
              >
                <X className="size-4" />
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="flex flex-col">
            <InlineNotice
              tone="success"
              className="mb-4"
              message={success?.area === 'detail' ? success.message : null}
            />
            {selected ? (
              <div className="flex flex-col gap-6">
                <form
                  noValidate
                  className="grid gap-4 sm:grid-cols-2"
                  onSubmit={editForm.handleSubmit(onEdit)}
                >
                  <FormField
                    label="Name"
                    htmlFor="edit-name"
                    error={editForm.formState.errors.name?.message}
                  >
                    <Input {...editForm.register('name')} />
                  </FormField>
                  <FormField label="Unit" htmlFor="edit-unit">
                    <Input {...editForm.register('unit')} />
                  </FormField>
                  <FormField
                    label="Email"
                    htmlFor="edit-email"
                    error={editForm.formState.errors.email?.message}
                    className="sm:col-span-2"
                  >
                    <Input type="email" {...editForm.register('email')} />
                  </FormField>
                  <div className="sm:col-span-2">
                    <h3 className="text-sm font-medium">Cardholder state</h3>
                  </div>
                  <FormActions className="sm:col-span-2">
                    <Button
                      type="submit"
                      variant="brand"
                      disabled={updateMutation.isPending}
                    >
                      Save changes
                    </Button>
                    {selected.status === 'active' ? (
                      <Button
                        type="button"
                        variant="danger"
                        disabled={updateMutation.isPending}
                        onClick={() =>
                          updateMutation.mutate({
                            id: selected.id,
                            input: { status: 'inactive' },
                          })
                        }
                      >
                        Deactivate and revoke cards
                      </Button>
                    ) : isAdmin ? (
                      <Button
                        type="button"
                        variant="secondary"
                        title="Restores the cards revoked when this cardholder was deactivated"
                        disabled={
                          updateMutation.isPending ||
                          activateRestoreMutation.isPending
                        }
                        onClick={() =>
                          activateRestoreMutation.mutate(selected.id)
                        }
                      >
                        Activate and restore cards
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={updateMutation.isPending}
                        onClick={() =>
                          updateMutation.mutate({
                            id: selected.id,
                            input: { status: 'active' },
                          })
                        }
                      >
                        Activate
                      </Button>
                    )}
                    {isAdmin ? (
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete ${selected.name}? Only possible if they have no credentials or history.`,
                            )
                          ) {
                            deleteMutation.mutate(selected.id)
                          }
                        }}
                      >
                        Delete permanently
                      </Button>
                    ) : null}
                  </FormActions>
                  <InlineNotice
                    message={errorMessage(
                      updateMutation.error ??
                        activateRestoreMutation.error ??
                        deleteMutation.error,
                    )}
                    className="sm:col-span-2"
                  />
                </form>

                <section className="border-t border-border pt-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h3 className="text-sm font-medium">
                      Credentials
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {credentials.length}{' '}
                        {credentials.length === 1 ? 'card' : 'cards'}
                      </span>
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          createCredentialMutation.reset()
                          setCredentialOpen((value) => !value)
                        }}
                        aria-expanded={credentialOpen}
                      >
                        {credentialOpen ? (
                          <X className="size-4" />
                        ) : (
                          <Plus className="size-4" />
                        )}
                        {credentialOpen ? 'Close form' : 'Add card'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={
                          revokeAllMutation.isPending ||
                          !credentials.some((item) => item.status === 'active')
                        }
                        onClick={() => {
                          if (
                            window.confirm(
                              'Revoke every active credential for this cardholder?',
                            )
                          ) {
                            revokeAllMutation.mutate()
                          }
                        }}
                      >
                        Revoke all
                      </Button>
                    </div>
                  </div>

                  <InlineNotice
                    message={errorMessage(credentialsQuery.error)}
                    className="mt-3"
                  />
                  <InlineNotice
                    message={errorMessage(
                      credentialMutation.error ?? revokeAllMutation.error,
                    )}
                    className="mt-3"
                  />
                  <InlineNotice
                    tone="success"
                    className="mt-3"
                    message={
                      success?.area === 'credentials' ? success.message : null
                    }
                  />

                  {credentialsQuery.isPending ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Loading credentials…
                    </p>
                  ) : credentials.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No credentials yet.
                    </p>
                  ) : (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {credentials.map((credential) => (
                        <div
                          key={credential.id}
                          className="flex h-full flex-col gap-3 rounded-lg border border-border bg-secondary/20 p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate font-mono text-sm">
                                {credential.uid}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {validityLabel(credential)}
                              </p>
                            </div>
                            <Badge
                              variant={
                                credential.status === 'active'
                                  ? 'success'
                                  : 'danger'
                              }
                            >
                              {credential.status}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <Badge
                              variant={
                                credential.has_pin ? 'secondary' : 'muted'
                              }
                            >
                              {credential.has_pin ? 'PIN set' : 'No PIN'}
                            </Badge>
                            {credential.pin_locked_until ? (
                              <Badge variant="danger">PIN locked</Badge>
                            ) : null}
                          </div>
                          <div className="mt-auto flex flex-wrap gap-1.5 border-t border-border pt-3">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                pinMutation.reset()
                                setPinTarget(credential)
                                setPinValue('')
                              }}
                            >
                              <KeyRound className="size-3.5" />
                              PIN
                            </Button>
                            {credential.status === 'active' ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={credentialMutation.isPending}
                                onClick={() =>
                                  credentialMutation.mutate({
                                    id: credential.id,
                                    action: 'revoke',
                                  })
                                }
                              >
                                Revoke
                              </Button>
                            ) : isAdmin ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                title={
                                  selected.status === 'inactive'
                                    ? 'Activate the cardholder first'
                                    : undefined
                                }
                                disabled={
                                  credentialMutation.isPending ||
                                  selected.status === 'inactive'
                                }
                                onClick={() =>
                                  credentialMutation.mutate({
                                    id: credential.id,
                                    action: 'restore',
                                  })
                                }
                              >
                                Restore
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={credentialMutation.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Delete ${credential.uid}? This only works if it was never used.`,
                                  )
                                ) {
                                  credentialMutation.mutate({
                                    id: credential.id,
                                    action: 'delete',
                                  })
                                }
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {pinTarget ? (
                    <form
                      className="mt-4 grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2"
                      onSubmit={(event) => {
                        event.preventDefault()
                        pinMutation.mutate({
                          id: pinTarget.id,
                          input: { pin: pinValue },
                        })
                      }}
                    >
                      <FormField
                        label={`PIN for ${pinTarget.uid}`}
                        htmlFor="pin-value"
                        hint="6–32 digits."
                        className="sm:col-span-2"
                      >
                        <PasswordInput
                          inputMode="numeric"
                          autoComplete="new-password"
                          value={pinValue}
                          onChange={(event) => setPinValue(event.target.value)}
                          placeholder="6–32 digits"
                        />
                      </FormField>
                      <FormActions className="sm:col-span-2">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            pinMutation.reset()
                            setPinTarget(null)
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={pinMutation.isPending || !pinTarget.has_pin}
                          onClick={() =>
                            pinMutation.mutate({
                              id: pinTarget.id,
                              input: { clear_pin: true },
                            })
                          }
                        >
                          Remove PIN
                        </Button>
                        <Button
                          type="submit"
                          variant="brand"
                          disabled={
                            pinMutation.isPending || !/^\d{6,32}$/.test(pinValue)
                          }
                        >
                          Save PIN
                        </Button>
                      </FormActions>
                    </form>
                  ) : null}
                  <InlineNotice
                    message={errorMessage(pinMutation.error)}
                    className="mt-2"
                  />

                  {credentialOpen ? (
                    <form
                      noValidate
                      className="mt-4 grid gap-4 rounded-lg border border-border p-3 sm:grid-cols-2"
                      onSubmit={credentialForm.handleSubmit(onAddCredential)}
                    >
                      <FormField
                        label="Card UID"
                        htmlFor="credential-uid"
                        hint="AA:BB:CC:DD"
                        error={credentialForm.formState.errors.uid?.message}
                      >
                        <Input
                          placeholder="AA:BB:CC:DD"
                          {...credentialForm.register('uid')}
                        />
                      </FormField>
                      <FormField
                        label="PIN (optional)"
                        htmlFor="credential-pin"
                        hint="6–32 digits."
                        error={credentialForm.formState.errors.pin?.message}
                      >
                        <PasswordInput
                          inputMode="numeric"
                          autoComplete="new-password"
                          placeholder="Leave empty for no PIN"
                          {...credentialForm.register('pin')}
                        />
                      </FormField>
                      <FormField label="Valid from" htmlFor="credential-from">
                        <Input
                          type="datetime-local"
                          {...credentialForm.register('valid_from')}
                        />
                      </FormField>
                      <FormField label="Valid to" htmlFor="credential-to">
                        <Input
                          type="datetime-local"
                          {...credentialForm.register('valid_to')}
                        />
                      </FormField>
                      <FormActions className="sm:col-span-2">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            createCredentialMutation.reset()
                            setCredentialOpen(false)
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          disabled={createCredentialMutation.isPending}
                        >
                          <Plus className="size-4" />
                          {createCredentialMutation.isPending
                            ? 'Adding card…'
                            : 'Add card'}
                        </Button>
                      </FormActions>
                      <InlineNotice
                        message={errorMessage(createCredentialMutation.error)}
                        className="sm:col-span-2"
                      />
                    </form>
                  ) : null}
                </section>
              </div>
            ) : (
              <p className="flex items-center justify-center py-10 text-center text-sm text-muted-foreground">
                Pick someone from the list.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
