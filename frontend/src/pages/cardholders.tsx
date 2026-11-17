import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Plus, UserPlus } from 'lucide-react'
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
import { useAuth } from '@/hooks/use-auth'
import {
  ApiError,
  createCardholder,
  createCredential,
  deleteCredential,
  listCardholders,
  listHolderCredentials,
  restoreCredential,
  revokeAllCredentials,
  revokeCredential,
  updateCardholder,
  updateCredential,
  type Credential,
  type CreateCredentialInput,
  type UpdateCardholderInput,
} from '@/lib/api'
import { formatDateTime } from '@/lib/format'

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

function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'Something went wrong. Try again.'
}

function toIso(value: string): string | null {
  return value === '' ? null : new Date(value).toISOString()
}

export function CardholdersPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pinTarget, setPinTarget] = useState<Credential | null>(null)
  const [pinValue, setPinValue] = useState('')

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
    queryClient.invalidateQueries({ queryKey: ['cardholders'] })
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
    if (selected) {
      editForm.reset({
        name: selected.name,
        email: selected.email ?? '',
        unit: selected.unit ?? '',
      })
    }
  }, [selected, editForm])

  const createMutation = useMutation({
    mutationFn: createCardholder,
    onSuccess: async (cardholder) => {
      createForm.reset()
      setSelectedId(cardholder.id)
      await invalidateCardholders()
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
    onSuccess: async () => {
      await Promise.all([invalidateCardholders(), invalidateCredentials()])
    },
  })

  const createCredentialMutation = useMutation({
    mutationFn: (input: CreateCredentialInput) =>
      createCredential(selectedId ?? '', input),
    onSuccess: async () => {
      credentialForm.reset()
      await invalidateCredentials()
    },
  })

  const credentialMutation = useMutation({
    mutationFn: async ({
      id,
      action,
    }: {
      id: string
      action: 'revoke' | 'restore' | 'delete'
    }) => {
      if (action === 'delete') {
        await deleteCredential(id)
      } else if (action === 'restore') {
        await restoreCredential(id)
      } else {
        await revokeCredential(id)
      }
    },
    onSuccess: invalidateCredentials,
  })

  const revokeAllMutation = useMutation({
    mutationFn: () => revokeAllCredentials(selectedId ?? ''),
    onSuccess: invalidateCredentials,
  })

  const pinMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: { pin: string } | { clear_pin: true }
    }) => updateCredential(id, input),
    onSuccess: async () => {
      setPinTarget(null)
      setPinValue('')
      await invalidateCredentials()
    },
  })

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
      <Card>
        <CardHeader>
          <CardTitle>Add cardholder</CardTitle>
          <CardDescription>
            Cardholders have credentials, and each credential is one card.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            className="grid gap-4 lg:grid-cols-[1.2fr_1.2fr_1fr_auto] lg:items-start"
            onSubmit={createForm.handleSubmit(onCreate)}
          >
            <div className="grid gap-2">
              <Label htmlFor="holder-name">Name</Label>
              <Input
                id="holder-name"
                placeholder="Ada Lovelace"
                aria-invalid={Boolean(createForm.formState.errors.name)}
                {...createForm.register('name')}
              />
              {createForm.formState.errors.name ? (
                <p className="text-xs text-red-400">
                  {createForm.formState.errors.name.message}
                </p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="holder-email">Email (optional)</Label>
              <Input
                id="holder-email"
                type="email"
                autoComplete="off"
                placeholder="ada@example.com"
                aria-invalid={Boolean(createForm.formState.errors.email)}
                {...createForm.register('email')}
              />
              {createForm.formState.errors.email ? (
                <p className="text-xs text-red-400">
                  {createForm.formState.errors.email.message}
                </p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="holder-unit">Unit (optional)</Label>
              <Input
                id="holder-unit"
                placeholder="Engineering"
                {...createForm.register('unit')}
              />
            </div>

            <Button
              type="submit"
              className="lg:mt-7"
              disabled={createMutation.isPending}
            >
              <UserPlus className="size-4" />
              {createMutation.isPending ? 'Adding' : 'Add'}
            </Button>
          </form>
          {createMutation.error ? (
            <p className="mt-3 text-sm text-red-400">
              {errorMessage(createMutation.error)}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr] lg:gap-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <CardTitle>Cardholders</CardTitle>
              <CardDescription>People who can hold credentials.</CardDescription>
            </div>
            <Badge variant="outline">{cardholders.length}</Badge>
          </CardHeader>
          <CardContent className="px-0">
            {cardholdersQuery.isPending ? (
              <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                Loading cardholders…
              </p>
            ) : cardholdersQuery.isError ? (
              <p className="px-6 py-10 text-center text-sm text-red-400">
                {errorMessage(cardholdersQuery.error)}
              </p>
            ) : cardholders.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                No cardholders yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-y border-border text-left text-xs text-muted-foreground">
                      <th className="px-6 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Unit</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-6 py-2 text-right font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cardholders.map((cardholder) => (
                      <tr
                        key={cardholder.id}
                        className="border-b border-border/60 last:border-0"
                      >
                        <td className="px-6 py-3">
                          <p className="font-medium">{cardholder.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {cardholder.email ?? 'No email'}
                          </p>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {cardholder.unit ?? '—'}
                        </td>
                        <td className="px-3 py-3">
                          <Badge
                            variant={
                              cardholder.status === 'active'
                                ? 'success'
                                : 'muted'
                            }
                          >
                            {cardholder.status}
                          </Badge>
                        </td>
                        <td className="px-6 py-3 text-right">
                          <Button
                            variant={
                              selectedId === cardholder.id
                                ? 'secondary'
                                : 'outline'
                            }
                            size="sm"
                            onClick={() => setSelectedId(cardholder.id)}
                          >
                            Manage
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {selected ? selected.name : 'Select a cardholder'}
            </CardTitle>
            <CardDescription>
              {selected
                ? 'Edit the person and manage their cards.'
                : 'Choose a cardholder to view their credentials.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selected ? (
              <div className="flex flex-col gap-6">
                <form
                  noValidate
                  className="grid gap-3 sm:grid-cols-2"
                  onSubmit={editForm.handleSubmit(onEdit)}
                >
                  <div className="grid gap-2">
                    <Label htmlFor="edit-name">Name</Label>
                    <Input
                      id="edit-name"
                      aria-invalid={Boolean(editForm.formState.errors.name)}
                      {...editForm.register('name')}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="edit-unit">Unit</Label>
                    <Input id="edit-unit" {...editForm.register('unit')} />
                  </div>
                  <div className="grid gap-2 sm:col-span-2">
                    <Label htmlFor="edit-email">Email</Label>
                    <Input
                      id="edit-email"
                      type="email"
                      aria-invalid={Boolean(editForm.formState.errors.email)}
                      {...editForm.register('email')}
                    />
                    {editForm.formState.errors.email ? (
                      <p className="text-xs text-red-400">
                        {editForm.formState.errors.email.message}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2 sm:col-span-2">
                    <Button
                      type="submit"
                      variant="outline"
                      disabled={updateMutation.isPending}
                    >
                      Save changes
                    </Button>
                    <Button
                      type="button"
                      variant={
                        selected.status === 'active' ? 'ghost' : 'secondary'
                      }
                      disabled={updateMutation.isPending}
                      onClick={() =>
                        updateMutation.mutate({
                          id: selected.id,
                          input: {
                            status:
                              selected.status === 'active'
                                ? 'inactive'
                                : 'active',
                          },
                        })
                      }
                    >
                      {selected.status === 'active'
                        ? 'Deactivate and revoke cards'
                        : 'Activate'}
                    </Button>
                  </div>
                  {updateMutation.error ? (
                    <p className="text-sm text-red-400 sm:col-span-2">
                      {errorMessage(updateMutation.error)}
                    </p>
                  ) : null}
                </form>

                <div className="border-t border-border pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-medium">Credentials</h3>
                      <p className="text-xs text-muted-foreground">
                        {credentials.length} card
                        {credentials.length === 1 ? '' : 's'}
                      </p>
                    </div>
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

                  {credentialsQuery.isPending ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Loading credentials…
                    </p>
                  ) : credentials.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No credentials yet.
                    </p>
                  ) : (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[520px] text-sm">
                        <thead>
                          <tr className="border-y border-border text-left text-xs text-muted-foreground">
                            <th className="py-2 pr-3 font-medium">UID</th>
                            <th className="px-3 py-2 font-medium">Validity</th>
                            <th className="px-3 py-2 font-medium">PIN</th>
                            <th className="px-3 py-2 font-medium">Status</th>
                            <th className="py-2 pl-3 text-right font-medium">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {credentials.map((credential) => (
                            <tr
                              key={credential.id}
                              className="border-b border-border/60 last:border-0"
                            >
                              <td className="py-3 pr-3 font-mono text-xs">
                                {credential.uid}
                              </td>
                              <td className="px-3 py-3 text-xs text-muted-foreground">
                                {credential.valid_to
                                  ? `Until ${formatDateTime(credential.valid_to)}`
                                  : 'No expiry'}
                              </td>
                              <td className="px-3 py-3">
                                <Badge
                                  variant={credential.has_pin ? 'secondary' : 'muted'}
                                >
                                  {credential.has_pin ? 'Set' : 'None'}
                                </Badge>
                              </td>
                              <td className="px-3 py-3">
                                <Badge
                                  variant={
                                    credential.status === 'active'
                                      ? 'success'
                                      : 'danger'
                                  }
                                >
                                  {credential.status}
                                </Badge>
                              </td>
                              <td className="py-3 pl-3">
                                <div className="flex flex-wrap justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
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
                                      disabled={credentialMutation.isPending}
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
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {credentialMutation.error ? (
                    <p className="mt-3 text-sm text-red-400">
                      {errorMessage(credentialMutation.error)}
                    </p>
                  ) : null}

                  {pinTarget ? (
                    <form
                      className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-border p-3"
                      onSubmit={(event) => {
                        event.preventDefault()
                        pinMutation.mutate({
                          id: pinTarget.id,
                          input: { pin: pinValue },
                        })
                      }}
                    >
                      <div className="grid flex-1 gap-2">
                        <Label htmlFor="pin-value">
                          PIN for {pinTarget.uid}
                        </Label>
                        <Input
                          id="pin-value"
                          type="password"
                          inputMode="numeric"
                          autoComplete="new-password"
                          value={pinValue}
                          onChange={(event) => setPinValue(event.target.value)}
                          placeholder="6 to 32 digits"
                        />
                      </div>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={
                          pinMutation.isPending ||
                          !/^\d{6,32}$/.test(pinValue)
                        }
                      >
                        Save PIN
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
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
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setPinTarget(null)}
                      >
                        Cancel
                      </Button>
                    </form>
                  ) : null}

                  {pinMutation.error ? (
                    <p className="mt-2 text-sm text-red-400">
                      {errorMessage(pinMutation.error)}
                    </p>
                  ) : null}

                  <form
                    noValidate
                    className="mt-4 grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2"
                    onSubmit={credentialForm.handleSubmit(onAddCredential)}
                  >
                    <div className="grid gap-2">
                      <Label htmlFor="credential-uid">Card UID</Label>
                      <Input
                        id="credential-uid"
                        placeholder="AA:BB:CC:DD"
                        aria-invalid={Boolean(
                          credentialForm.formState.errors.uid,
                        )}
                        {...credentialForm.register('uid')}
                      />
                      {credentialForm.formState.errors.uid ? (
                        <p className="text-xs text-red-400">
                          {credentialForm.formState.errors.uid.message}
                        </p>
                      ) : null}
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="credential-pin">PIN (optional)</Label>
                      <Input
                        id="credential-pin"
                        type="password"
                        inputMode="numeric"
                        autoComplete="new-password"
                        placeholder="Leave empty for no PIN"
                        aria-invalid={Boolean(
                          credentialForm.formState.errors.pin,
                        )}
                        {...credentialForm.register('pin')}
                      />
                      {credentialForm.formState.errors.pin ? (
                        <p className="text-xs text-red-400">
                          {credentialForm.formState.errors.pin.message}
                        </p>
                      ) : null}
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="credential-from">Valid from</Label>
                      <Input
                        id="credential-from"
                        type="datetime-local"
                        {...credentialForm.register('valid_from')}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="credential-to">Valid to</Label>
                      <Input
                        id="credential-to"
                        type="datetime-local"
                        {...credentialForm.register('valid_to')}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Button
                        type="submit"
                        size="sm"
                        disabled={createCredentialMutation.isPending}
                      >
                        <Plus className="size-4" />
                        {createCredentialMutation.isPending
                          ? 'Adding card'
                          : 'Add card'}
                      </Button>
                    </div>
                    {createCredentialMutation.error ? (
                      <p className="text-sm text-red-400 sm:col-span-2">
                        {errorMessage(createCredentialMutation.error)}
                      </p>
                    ) : null}
                  </form>
                </div>
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Pick someone from the list.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
