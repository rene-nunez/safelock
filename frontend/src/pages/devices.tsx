import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Cpu, Plus, X } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { useSearchParams } from 'react-router-dom'
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
import { FormActions } from '@/components/ui/form-actions'
import { FormField } from '@/components/ui/form-field'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/hooks/use-auth'
import {
  ApiError,
  createDevice,
  deleteDevice,
  listDevices,
  updateDevice,
  type CreateDeviceInput,
  type DeviceLocation,
  type UpdateDeviceInput,
} from '@/lib/api'
import { formatDateTime } from '@/lib/format'

const coordinate = (min: number, max: number) =>
  z
    .string()
    .trim()
    .refine(
      (value) =>
        value === '' ||
        (!Number.isNaN(Number(value)) &&
          Number(value) >= min &&
          Number(value) <= max),
      { message: `Use a number between ${min} and ${max}` },
    )

const createSchema = z
  .object({
    device_id: z
      .string()
      .trim()
      .regex(/^sl-\d{4}$/i, 'Use the format sl-0001'),
    name: z.string().trim().min(1, 'Enter a name'),
    site: z.string().trim(),
    lat: coordinate(-90, 90),
    lng: coordinate(-180, 180),
  })
  .refine((values) => (values.lat === '') === (values.lng === ''), {
    message: 'Set both latitude and longitude, or neither',
    path: ['lng'],
  })

const settingsSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name'),
    site: z.string().trim(),
    lat: coordinate(-90, 90),
    lng: coordinate(-180, 180),
    offline_policy: z.enum(['allow', 'deny']),
    stale_acl_hours: z
      .string()
      .regex(/^\d+$/, 'Use a whole number')
      .refine((value) => Number(value) >= 1 && Number(value) <= 8760, {
        message: 'Use 1 to 8760 hours',
      }),
    unlock_ms: z
      .string()
      .regex(/^\d+$/, 'Use a whole number')
      .refine((value) => Number(value) >= 100 && Number(value) <= 30_000, {
        message: 'Use 100 to 30000 ms',
      }),
    requires_pin: z.boolean(),
  })
  .refine((values) => (values.lat === '') === (values.lng === ''), {
    message: 'Set both latitude and longitude, or neither',
    path: ['lng'],
  })

type CreateValues = z.infer<typeof createSchema>
type SettingsValues = z.infer<typeof settingsSchema>
type NoticeArea = 'page' | 'detail'

function errorMessage(error: unknown): string | null {
  if (error === null || error === undefined) return null
  return error instanceof ApiError
    ? error.message
    : 'Something went wrong. Try again.'
}

function locationFrom(lat: string, lng: string) {
  return lat === '' ? null : { lat: Number(lat), lng: Number(lng) }
}

function parseLocation(lat: string, lng: string): DeviceLocation | null {
  if (lat.trim() === '' || lng.trim() === '') return null
  const parsedLat = Number(lat)
  const parsedLng = Number(lng)
  if (
    Number.isNaN(parsedLat) ||
    Number.isNaN(parsedLng) ||
    parsedLat < -90 ||
    parsedLat > 90 ||
    parsedLng < -180 ||
    parsedLng > 180
  ) {
    return null
  }
  return { lat: parsedLat, lng: parsedLng }
}

const LocationPicker = lazy(async () => {
  const module = await import('@/components/map/location-picker')
  return { default: module.LocationPicker }
})

function LazyMapPicker(props: ComponentProps<typeof LocationPicker>) {
  return (
    <Suspense
      fallback={
        <div
          className={`w-full animate-pulse rounded-lg border border-border bg-secondary/40 ${props.className ?? ''}`}
        />
      }
    >
      <LocationPicker {...props} />
    </Suspense>
  )
}

function StatusTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
        {children}
      </div>
    </div>
  )
}

export function DevicesPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [success, setSuccess] = useState<{
    message: string
    area: NoticeArea
  } | null>(null)

  function showSuccess(message: string, area: NoticeArea = 'page') {
    setSuccess({ message, area })
  }

  const devicesQuery = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const devices = devicesQuery.data ?? []
  const selected = devices.find((device) => device.id === selectedId) ?? null

  const requestedDevice = searchParams.get('device')
  useEffect(() => {
    if (!requestedDevice || !devicesQuery.data) return
    const match = devicesQuery.data.find(
      (device) =>
        device.device_id.toLowerCase() === requestedDevice.toLowerCase(),
    )
    if (!match) return
    setSelectedId(match.id)
    setSearchParams({}, { replace: true })
  }, [devicesQuery.data, requestedDevice, setSearchParams])

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['devices'] })

  const createForm = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      device_id: '',
      name: '',
      site: '',
      lat: '',
      lng: '',
    },
  })
  const settingsForm = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      name: '',
      site: '',
      lat: '',
      lng: '',
      offline_policy: 'allow',
      stale_acl_hours: '72',
      unlock_ms: '3000',
      requires_pin: false,
    },
  })

  const createLat = useWatch({ control: createForm.control, name: 'lat' })
  const createLng = useWatch({ control: createForm.control, name: 'lng' })
  const settingsLat = useWatch({ control: settingsForm.control, name: 'lat' })
  const settingsLng = useWatch({ control: settingsForm.control, name: 'lng' })
  const createLocation = parseLocation(createLat, createLng)
  const settingsLocation = parseLocation(settingsLat, settingsLng)

  function applyCreateLocation(next: DeviceLocation | null) {
    createForm.setValue('lat', next ? String(next.lat) : '', {
      shouldValidate: true,
    })
    createForm.setValue('lng', next ? String(next.lng) : '', {
      shouldValidate: true,
    })
  }

  function applySettingsLocation(next: DeviceLocation | null) {
    settingsForm.setValue('lat', next ? String(next.lat) : '', {
      shouldValidate: true,
    })
    settingsForm.setValue('lng', next ? String(next.lng) : '', {
      shouldValidate: true,
    })
  }

  useEffect(() => {
    if (!selected) return
    settingsForm.reset({
      name: selected.name,
      site: selected.site ?? '',
      lat: selected.location ? String(selected.location.lat) : '',
      lng: selected.location ? String(selected.location.lng) : '',
      offline_policy: selected.offline_policy,
      stale_acl_hours: String(selected.stale_acl_hours),
      unlock_ms: String(selected.unlock_ms),
      requires_pin: selected.requires_pin,
    })
    // Reset only when switching devices, not after a background refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  const createMutation = useMutation({
    mutationFn: createDevice,
    onMutate: () => setSuccess(null),
    onSuccess: async (device) => {
      createForm.reset()
      setCreateOpen(false)
      setSelectedId(device.id)
      showSuccess('Device added.')
      await invalidate()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateDeviceInput }) =>
      updateDevice(id, input),
    onMutate: () => setSuccess(null),
    onSuccess: async (_device, { input }) => {
      if ('locked' in input) {
        showSuccess(
          input.locked ? 'Remote lock enabled.' : 'Remote lock removed.',
          'detail',
        )
      } else if ('status' in input) {
        showSuccess(
          input.status === 'retired' ? 'Device retired.' : 'Device reactivated.',
          'detail',
        )
      } else {
        showSuccess('Device settings saved.', 'detail')
      }
      await invalidate()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteDevice,
    onMutate: () => setSuccess(null),
    onSuccess: async () => {
      setSelectedId(null)
      showSuccess('Device deleted.', 'detail')
      await invalidate()
    },
  })

  function onCreate(values: CreateValues) {
    const input: CreateDeviceInput = {
      device_id: values.device_id.toLowerCase(),
      name: values.name,
      site: values.site === '' ? null : values.site,
      location: locationFrom(values.lat, values.lng),
    }
    createMutation.mutate(input)
  }

  function onSave(values: SettingsValues) {
    if (!selected) return
    updateMutation.mutate({
      id: selected.id,
      input: {
        name: values.name,
        site: values.site === '' ? null : values.site,
        location: locationFrom(values.lat, values.lng),
        offline_policy: values.offline_policy,
        stale_acl_hours: Number(values.stale_acl_hours),
        unlock_ms: Number(values.unlock_ms),
        requires_pin: values.requires_pin,
      },
    })
  }

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <PageHeader
        title="Devices"
        description="Locks registered in Safelock and their access policies."
        actions={
          isAdmin ? (
            <Button
              onClick={() => setCreateOpen((value) => !value)}
              aria-expanded={createOpen}
            >
              {createOpen ? (
                <X className="size-4" />
              ) : (
                <Plus className="size-4" />
              )}
              {createOpen ? 'Close form' : 'Add device'}
            </Button>
          ) : null
        }
      />

      <InlineNotice
        tone="success"
        message={success?.area === 'page' ? success.message : null}
      />

      {createOpen && isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Add device</CardTitle>
            <CardDescription>
              Register a lock before it connects for the first time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              noValidate
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={createForm.handleSubmit(onCreate)}
            >
              <FormField
                label="Device ID"
                htmlFor="device-id"
                hint="Format sl-0001"
                error={createForm.formState.errors.device_id?.message}
              >
                <Input
                  placeholder="sl-0001"
                  {...createForm.register('device_id')}
                />
              </FormField>
              <FormField
                label="Name"
                htmlFor="device-name"
                error={createForm.formState.errors.name?.message}
              >
                <Input
                  placeholder="Front door"
                  {...createForm.register('name')}
                />
              </FormField>
              <FormField label="Site (optional)" htmlFor="device-site">
                <Input placeholder="HQ" {...createForm.register('site')} />
              </FormField>
              <div className="sm:col-span-2">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Location on map</p>
                    <p className="text-xs text-muted-foreground">
                      Click to place the lock, then drag the marker to adjust.
                    </p>
                  </div>
                  {createLocation ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => applyCreateLocation(null)}
                    >
                      Clear location
                    </Button>
                  ) : null}
                </div>
                <LazyMapPicker
                  value={createLocation}
                  onChange={applyCreateLocation}
                  className="h-56"
                />
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <FormField
                    label="Latitude"
                    htmlFor="device-lat"
                    error={createForm.formState.errors.lat?.message}
                  >
                    <Input
                      placeholder="-33.45"
                      {...createForm.register('lat')}
                    />
                  </FormField>
                  <FormField
                    label="Longitude"
                    htmlFor="device-lng"
                    error={createForm.formState.errors.lng?.message}
                  >
                    <Input
                      placeholder="-70.66"
                      {...createForm.register('lng')}
                    />
                  </FormField>
                </div>
              </div>
              <FormActions className="sm:col-span-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setCreateOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  <Plus className="size-4" />
                  {createMutation.isPending ? 'Adding…' : 'Add device'}
                </Button>
              </FormActions>
            </form>
            <InlineNotice
              message={errorMessage(createMutation.error)}
              className="mt-3"
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] xl:gap-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <CardTitle>Devices</CardTitle>
              <CardDescription>Locks registered in Safelock.</CardDescription>
            </div>
            <Badge variant="outline">{devices.length}</Badge>
          </CardHeader>
          <CardContent className="px-0">
            <InlineNotice
              message={errorMessage(devicesQuery.error)}
              className="mx-6 mb-3"
            />
            {devicesQuery.isPending ? (
              <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                Loading devices…
              </p>
            ) : devices.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                No devices yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {devices.map((device) => (
                  <li
                    key={device.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
                      <Cpu className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{device.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {device.device_id}
                        {device.site ? ` · ${device.site}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge
                        variant={device.online ? 'success' : 'muted'}
                      >
                        {device.online ? 'Online' : 'Offline'}
                      </Badge>
                      <Badge
                        variant={device.locked ? 'danger' : 'outline'}
                      >
                        {device.locked ? 'Locked' : 'Unlocked'}
                      </Badge>
                      {device.requires_pin ? (
                        <Badge variant="secondary">PIN</Badge>
                      ) : null}
                      {device.status === 'retired' ? (
                        <Badge variant="muted">Retired</Badge>
                      ) : null}
                    </div>
                    <Button
                      variant={
                        selectedId === device.id ? 'secondary' : 'outline'
                      }
                      size="sm"
                      onClick={() => setSelectedId(device.id)}
                    >
                      {selectedId === device.id ? 'Editing' : 'Manage'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{selected ? selected.name : 'Select a device'}</CardTitle>
            <CardDescription>
              {selected
                ? `${selected.device_id} · firmware ${selected.fw ?? 'unknown'} · ACL v${selected.acl_version}`
                : 'Choose a device from the list to review or change its settings.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InlineNotice
              tone="success"
              className="mb-4"
              message={success?.area === 'detail' ? success.message : null}
            />
            {selected ? (
              <div className="flex flex-col gap-6">
                <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <StatusTile label="Connectivity">
                    <Badge variant={selected.online ? 'success' : 'muted'}>
                      {selected.online ? 'Online' : 'Offline'}
                    </Badge>
                  </StatusTile>
                  <StatusTile label="Last seen">
                    <span className="text-xs text-muted-foreground">
                      {selected.last_seen
                        ? formatDateTime(selected.last_seen)
                        : 'Never connected'}
                    </span>
                  </StatusTile>
                  <StatusTile label="Firmware">
                    <span className="font-mono text-xs">
                      {selected.fw ?? 'Unknown'}
                    </span>
                  </StatusTile>
                  <StatusTile label="Access list">
                    <span className="text-xs text-muted-foreground">
                      v{selected.acl_version} ·{' '}
                      {selected.last_sync_at
                        ? formatDateTime(selected.last_sync_at)
                        : 'Never synced'}
                    </span>
                  </StatusTile>
                </section>

                <section className="border-t border-border pt-5">
                  <h3 className="text-sm font-medium">Actions</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Remote lock denies every access until it is removed.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant={selected.locked ? 'secondary' : 'destructive'}
                      size="sm"
                      disabled={updateMutation.isPending}
                      onClick={() =>
                        updateMutation.mutate({
                          id: selected.id,
                          input: { locked: !selected.locked },
                        })
                      }
                    >
                      {selected.locked
                        ? 'Remove remote lock'
                        : 'Lock remotely'}
                    </Button>
                    {isAdmin ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={updateMutation.isPending}
                          onClick={() =>
                            updateMutation.mutate({
                              id: selected.id,
                              input: {
                                status:
                                  selected.status === 'active'
                                    ? 'retired'
                                    : 'active',
                              },
                            })
                          }
                        >
                          {selected.status === 'active'
                            ? 'Retire'
                            : 'Reactivate'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={deleteMutation.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete ${selected.device_id}? This only works if it never connected and has no history.`,
                              )
                            ) {
                              deleteMutation.mutate(selected.id)
                            }
                          }}
                        >
                          Delete permanently
                        </Button>
                      </>
                    ) : null}
                  </div>
                  <InlineNotice
                    message={errorMessage(updateMutation.error ?? deleteMutation.error)}
                    className="mt-3"
                  />
                </section>

                {isAdmin ? (
                  <form
                    noValidate
                    className="flex flex-col gap-4 border-t border-border pt-5"
                    onSubmit={settingsForm.handleSubmit(onSave)}
                  >
                    <div>
                      <h3 className="text-sm font-medium">Settings</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Changes reach the device on its next synchronization.
                      </p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField
                        label="Name"
                        htmlFor="settings-name"
                        error={settingsForm.formState.errors.name?.message}
                      >
                        <Input {...settingsForm.register('name')} />
                      </FormField>
                      <FormField label="Site" htmlFor="settings-site">
                        <Input {...settingsForm.register('site')} />
                      </FormField>
                      <FormField
                        label="Offline policy"
                        htmlFor="settings-policy"
                        hint="Allow access with a cached list, or deny without the backend."
                      >
                        <Select {...settingsForm.register('offline_policy')}>
                          <option value="allow">Allow with cached ACL</option>
                          <option value="deny">Deny without backend</option>
                        </Select>
                      </FormField>
                      <FormField
                        label="Stale ACL hours"
                        htmlFor="settings-stale"
                        hint="How long the cached list stays valid offline."
                        error={
                          settingsForm.formState.errors.stale_acl_hours?.message
                        }
                      >
                        <Input
                          inputMode="numeric"
                          {...settingsForm.register('stale_acl_hours')}
                        />
                      </FormField>
                      <FormField
                        label="Unlock duration (ms)"
                        htmlFor="settings-unlock"
                        hint="Time the bolt stays open after a valid access."
                        error={settingsForm.formState.errors.unlock_ms?.message}
                      >
                        <Input
                          inputMode="numeric"
                          {...settingsForm.register('unlock_ms')}
                        />
                      </FormField>
                      <div className="flex items-end">
                        <label className="flex items-start gap-2 pb-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-0.5 size-4 rounded border-input"
                            {...settingsForm.register('requires_pin')}
                          />
                          <span>
                            Require PIN on this door
                            <span className="block text-xs text-muted-foreground">
                              The door becomes online-only.
                            </span>
                          </span>
                        </label>
                      </div>
                      <div className="sm:col-span-2">
                        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium">
                              Location on map
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Click to place the lock, then drag the marker to
                              adjust.
                            </p>
                          </div>
                          {settingsLocation ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => applySettingsLocation(null)}
                            >
                              Clear location
                            </Button>
                          ) : null}
                        </div>
                        <LazyMapPicker
                          value={settingsLocation}
                          onChange={applySettingsLocation}
                          className="h-64"
                        />
                        <p className="mt-2 font-mono text-xs text-muted-foreground">
                          Latitude {settingsLat || '—'} · Longitude{' '}
                          {settingsLng || '—'}
                        </p>
                      </div>
                    </div>
                    <FormActions>
                      <Button
                        type="submit"
                        variant="outline"
                        disabled={updateMutation.isPending}
                      >
                        Save settings
                      </Button>
                    </FormActions>
                  </form>
                ) : (
                  <section className="flex flex-col gap-4 border-t border-border pt-5">
                    <h3 className="text-sm font-medium">Settings</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <StatusTile label="Offline policy">
                        <span className="text-sm">
                          {selected.offline_policy === 'allow'
                            ? 'Allow with cached ACL'
                            : 'Deny without backend'}
                        </span>
                      </StatusTile>
                      <StatusTile label="Stale ACL">
                        <span className="text-sm">
                          {selected.stale_acl_hours} h
                        </span>
                      </StatusTile>
                      <StatusTile label="Unlock duration">
                        <span className="text-sm">{selected.unlock_ms} ms</span>
                      </StatusTile>
                      <StatusTile label="PIN required">
                        <Badge
                          variant={selected.requires_pin ? 'secondary' : 'muted'}
                        >
                          {selected.requires_pin ? 'Yes (online only)' : 'No'}
                        </Badge>
                      </StatusTile>
                    </div>
                    <div>
                      <p className="text-sm font-medium">Location on map</p>
                      <LazyMapPicker
                        value={selected.location}
                        onChange={() => undefined}
                        disabled
                        className="h-56"
                      />
                    </div>
                  </section>
                )}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Pick a device from the list.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
