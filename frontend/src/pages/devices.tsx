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
import { ChevronRight, Plus, RefreshCw, X } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { useSearchParams } from 'react-router-dom'
import { z } from 'zod'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { FormActions } from '@/components/ui/form-actions'
import { FormField } from '@/components/ui/form-field'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Input } from '@/components/ui/input'
import { PageToolbar } from '@/components/ui/page-toolbar'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/hooks/use-auth'
import {
  ApiError,
  createDevice,
  deleteDevice,
  listDevices,
  synchronizeAccessList,
  updateDevice,
  type CreateDeviceInput,
  type Device,
  type DeviceLocation,
  type UpdateDeviceInput,
} from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

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
  })
  .refine((values) => (values.lat === '') === (values.lng === ''), {
    message: 'Set both latitude and longitude, or neither',
    path: ['lng'],
  })

type CreateValues = z.infer<typeof createSchema>
type SettingsValues = z.infer<typeof settingsSchema>
type NoticeArea = 'page' | 'detail' | 'settings'

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

function StatusRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-xs first:pt-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
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

  function resetSettingsForm(device: Device) {
    settingsForm.reset({
      name: device.name,
      site: device.site ?? '',
      lat: device.location ? String(device.location.lat) : '',
      lng: device.location ? String(device.location.lng) : '',
      offline_policy: device.offline_policy,
      stale_acl_hours: String(device.stale_acl_hours),
      unlock_ms: String(device.unlock_ms),
    })
  }

  function closeDetail() {
    setSuccess(null)
    resetPanelMutations()
    settingsForm.reset()
    setSelectedId(null)
    if (requestedDevice) setSearchParams({}, { replace: true })
  }

  const devicesQuery = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const devices = devicesQuery.data ?? []
  const selected = devices.find((device) => device.id === selectedId) ?? null
  const onlineCount = devices.filter((device) => device.online).length

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
    resetPanelMutations()
    if (!selected) return
    resetSettingsForm(selected)
    // Reset only when switching devices, not after a background refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  const createMutation = useMutation({
    mutationFn: createDevice,
    onMutate: () => setSuccess(null),
    onSuccess: (device) => {
      createForm.reset()
      setCreateOpen(false)
      setSelectedId(device.id)
      showSuccess('Device added.')
      void invalidate()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateDeviceInput }) =>
      updateDevice(id, input),
    onMutate: () => {
      setSuccess(null)
      resetDetailMutations('update')
    },
    onSuccess: (updated, { input }) => {
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
      } else if ('requires_pin' in input) {
        showSuccess(
          input.requires_pin
            ? 'PIN requirement enabled.'
            : 'PIN requirement removed.',
          'detail',
        )
      } else {
        showSuccess('Device settings saved.', 'settings')
        resetSettingsForm(updated)
      }
      void invalidate()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteDevice,
    onMutate: () => {
      setSuccess(null)
      resetDetailMutations('delete')
    },
    onSuccess: () => {
      setSelectedId(null)
      showSuccess('Device deleted.', 'detail')
      void invalidate()
    },
  })

  const syncMutation = useMutation({
    mutationFn: synchronizeAccessList,
    onMutate: () => {
      setSuccess(null)
      resetDetailMutations('sync')
    },
    onSuccess: (command) => {
      showSuccess(
        `Access list v${command.acl_version} sent to the device.`,
        'detail',
      )
      void invalidate()
    },
  })

  function resetDetailMutations(skip?: 'update' | 'delete' | 'sync') {
    if (skip !== 'update') updateMutation.reset()
    if (skip !== 'delete') deleteMutation.reset()
    if (skip !== 'sync') syncMutation.reset()
  }

  function resetPanelMutations() {
    resetDetailMutations()
    createMutation.reset()
  }

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
      },
    })
  }

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <PageToolbar>
        {isAdmin ? (
          <Button
            onClick={() => {
              createMutation.reset()
              setCreateOpen((value) => !value)
            }}
            aria-expanded={createOpen}
          >
            {createOpen ? <X className="size-4" /> : <Plus className="size-4" />}
            {createOpen ? 'Close form' : 'Add device'}
          </Button>
        ) : null}
      </PageToolbar>

      <InlineNotice
        tone="success"
        message={success?.area === 'page' ? success.message : null}
      />

      {createOpen && isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Add device</CardTitle>
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
                <p className="mb-2 text-sm font-medium">Location on map</p>
                <LazyMapPicker
                  value={createLocation}
                  onChange={applyCreateLocation}
                  className="h-[448px] w-full"
                />
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <FormField
                    label="Latitude"
                    htmlFor="device-lat"
                    error={createForm.formState.errors.lat?.message}
                    reserveMessage={false}
                  >
                    <Input
                      inputMode="decimal"
                      placeholder="-33.45"
                      {...createForm.register('lat')}
                    />
                  </FormField>
                  <FormField
                    label="Longitude"
                    htmlFor="device-lng"
                    error={createForm.formState.errors.lng?.message}
                    reserveMessage={false}
                  >
                    <Input
                      inputMode="decimal"
                      placeholder="-70.66"
                      {...createForm.register('lng')}
                    />
                  </FormField>
                </div>
                <div className="mt-2 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={createLocation === null}
                    onClick={() => applyCreateLocation(null)}
                  >
                    Clear location
                  </Button>
                </div>
              </div>
              <FormActions className="mt-4 sm:col-span-2">
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

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] xl:gap-6">
        <Card>
          <CardContent className="flex flex-col px-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-6 pb-3">
              <span className="text-2xl font-semibold tabular-nums">
                {onlineCount}
              </span>
              <span className="text-xs text-muted-foreground">
                online / {devices.length} total
              </span>
            </div>
            <InlineNotice
              message={errorMessage(devicesQuery.error)}
              className="mx-6 mb-3"
            />
            {devicesQuery.isPending ? (
              <p className="flex items-center justify-center px-6 py-10 text-center text-sm text-muted-foreground">
                Loading devices…
              </p>
            ) : devices.length === 0 ? (
              <p className="flex items-center justify-center px-6 py-10 text-center text-sm text-muted-foreground">
                No devices yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {devices.map((device) => {
                  const active = selectedId === device.id
                  return (
                    <li key={device.id}>
                      <button
                        type="button"
                        aria-current={active ? 'true' : undefined}
                        onClick={() => {
                          setSuccess(null)
                          setSelectedId(device.id)
                        }}
                        className={cn(
                          'flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                          active && 'bg-accent',
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{device.name}</p>
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
                            <Badge className="border-secondary-foreground/20 bg-secondary text-secondary-foreground">
                              PIN
                            </Badge>
                          ) : null}
                          {device.status === 'retired' ? (
                            <Badge variant="muted">Retired</Badge>
                          ) : null}
                        </div>
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
            <div className="min-w-0 flex-1">
              <CardTitle className="break-words leading-snug">
                {selected ? selected.name : 'Select a device'}
              </CardTitle>
              {selected ? (
                <p className="font-mono text-xs text-muted-foreground">
                  {selected.device_id}
                </p>
              ) : null}
            </div>
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
            {selected ? null : (
              <InlineNotice
                tone="success"
                className="mb-4"
                message={success?.area === 'detail' ? success.message : null}
              />
            )}
            {selected ? (
              <div className="flex flex-col gap-6">
                <section aria-label="Device status">
                  <dl className="divide-y divide-border">
                    <StatusRow label="Connectivity">
                      <Badge variant={selected.online ? 'success' : 'muted'}>
                        {selected.online ? 'Online' : 'Offline'}
                      </Badge>
                    </StatusRow>
                    <StatusRow label="Last seen">
                      <span className="text-muted-foreground">
                        {selected.last_seen
                          ? formatDateTime(selected.last_seen)
                          : 'Never connected'}
                      </span>
                    </StatusRow>
                    <StatusRow label="Firmware">
                      <span className="font-mono">{selected.fw ?? 'Unknown'}</span>
                    </StatusRow>
                    <StatusRow label="Access list">
                      <span className="text-muted-foreground">
                        v{selected.acl_version} ·{' '}
                        {selected.last_sync_at
                          ? formatDateTime(selected.last_sync_at)
                          : 'Never synced'}
                      </span>
                    </StatusRow>
                  </dl>
                </section>

                <section className="border-t border-border pt-5">
                  <h3 className="text-sm font-medium">Actions</h3>
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
                          title={
                            selected.online
                              ? 'Send the full access list now'
                              : 'The device must be online to receive the access list'
                          }
                          disabled={!selected.online || syncMutation.isPending}
                          onClick={() => syncMutation.mutate(selected.id)}
                        >
                          <RefreshCw className="size-4" />
                          {syncMutation.isPending
                            ? 'Syncing...'
                            : 'Sync access list'}
                        </Button>
                        <Button
                          variant={
                            selected.requires_pin ? 'secondary' : 'outline'
                          }
                          size="sm"
                          title={
                            selected.requires_pin
                              ? 'Removing PIN allows offline card access'
                              : 'PIN-enabled doors are online-only'
                          }
                          aria-label={
                            selected.requires_pin
                              ? 'Remove PIN requirement'
                              : 'Require PIN'
                          }
                          disabled={updateMutation.isPending}
                          onClick={() =>
                            updateMutation.mutate({
                              id: selected.id,
                              input: { requires_pin: !selected.requires_pin },
                            })
                          }
                        >
                          {selected.requires_pin ? 'Remove PIN' : 'Require PIN'}
                        </Button>
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
                    tone="success"
                    message={success?.area === 'detail' ? success.message : null}
                    className="mt-3"
                  />
                  <InlineNotice
                    message={errorMessage(
                      updateMutation.error ??
                        deleteMutation.error ??
                        syncMutation.error,
                    )}
                    className="mt-3"
                  />
                </section>

                {isAdmin ? (
                  <form
                    noValidate
                    className="flex flex-col gap-4 border-t border-border pt-5"
                    onSubmit={settingsForm.handleSubmit(onSave)}
                  >
                    <h3 className="text-sm font-medium">Settings</h3>
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
                      >
                        <Select {...settingsForm.register('offline_policy')}>
                          <option value="allow">Allow with cached ACL</option>
                          <option value="deny">Deny without backend</option>
                        </Select>
                      </FormField>
                      <FormField
                        label="Stale ACL hours"
                        htmlFor="settings-stale"
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
                        error={settingsForm.formState.errors.unlock_ms?.message}
                      >
                        <Input
                          inputMode="numeric"
                          {...settingsForm.register('unlock_ms')}
                        />
                      </FormField>
                      <div className="sm:col-span-2">
                        <p className="mb-2 text-sm font-medium">
                          Location on map
                        </p>
                        <LazyMapPicker
                          value={settingsLocation}
                          onChange={applySettingsLocation}
                          className="h-64"
                        />
                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                          <FormField
                            label="Latitude"
                            htmlFor="settings-lat"
                            error={settingsForm.formState.errors.lat?.message}
                            reserveMessage={false}
                          >
                            <Input
                              inputMode="decimal"
                              placeholder="-33.45"
                              {...settingsForm.register('lat')}
                            />
                          </FormField>
                          <FormField
                            label="Longitude"
                            htmlFor="settings-lng"
                            error={settingsForm.formState.errors.lng?.message}
                            reserveMessage={false}
                          >
                            <Input
                              inputMode="decimal"
                              placeholder="-70.66"
                              {...settingsForm.register('lng')}
                            />
                          </FormField>
                        </div>
                        <div className="mt-2 flex justify-end">
                          <Button
                            type="button"
                            variant="outline"
                            disabled={settingsLocation === null}
                            onClick={() => applySettingsLocation(null)}
                          >
                            Clear location
                          </Button>
                        </div>
                      </div>
                    </div>
                    <InlineNotice
                      tone="success"
                      message={
                        success?.area === 'settings' ? success.message : null
                      }
                    />
                    <FormActions className="mt-4">
                      <Button
                        type="submit"
                        disabled={updateMutation.isPending}
                      >
                        Save settings
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={
                          updateMutation.isPending ||
                          !settingsForm.formState.isDirty
                        }
                        onClick={() => {
                          if (selected) resetSettingsForm(selected)
                          updateMutation.reset()
                          setSuccess(null)
                        }}
                      >
                        Revert changes
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
                      <p className="mb-2 text-sm font-medium">
                        Location on map
                      </p>
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
              <p className="flex items-center justify-center py-10 text-center text-sm text-muted-foreground">
                Pick a device from the list.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
