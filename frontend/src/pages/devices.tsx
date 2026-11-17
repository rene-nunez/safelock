import { lazy, Suspense, useEffect, useState, type ComponentProps } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Cpu, Plus } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
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

function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'Something went wrong. Try again.'
}

function locationFrom(lat: string, lng: string) {
  return lat === '' ? null : { lat: Number(lat), lng: Number(lng) }
}

const LocationPicker = lazy(async () => {
  const module = await import('@/components/map/location-picker')
  return { default: module.LocationPicker }
})

function MapPicker(props: ComponentProps<typeof LocationPicker>) {
  return (
    <Suspense
      fallback={
        <div
          className={`w-full animate-pulse rounded-lg border border-border bg-secondary/40 ${props.className ?? ''}`}
        />
      }
    >
      <MapPicker {...props} />
    </Suspense>
  )
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

export function DevicesPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const devicesQuery = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const devices = devicesQuery.data ?? []
  const selected = devices.find((device) => device.id === selectedId) ?? null

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
    if (selected) {
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
    }
  }, [selected, settingsForm])

  const createMutation = useMutation({
    mutationFn: createDevice,
    onSuccess: async (device) => {
      createForm.reset()
      setSelectedId(device.id)
      await invalidate()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateDeviceInput }) =>
      updateDevice(id, input),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: deleteDevice,
    onSuccess: async () => {
      setSelectedId(null)
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
      {isAdmin ? (
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
              className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr_1fr_0.7fr_0.7fr_auto] lg:items-start"
              onSubmit={createForm.handleSubmit(onCreate)}
            >
              <div className="grid gap-2">
                <Label htmlFor="device-id">Device ID</Label>
                <Input
                  id="device-id"
                  placeholder="sl-0001"
                  aria-invalid={Boolean(createForm.formState.errors.device_id)}
                  {...createForm.register('device_id')}
                />
                {createForm.formState.errors.device_id ? (
                  <p className="text-xs text-red-400">
                    {createForm.formState.errors.device_id.message}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="device-name">Name</Label>
                <Input
                  id="device-name"
                  placeholder="Front door"
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
                <Label htmlFor="device-site">Site (optional)</Label>
                <Input
                  id="device-site"
                  placeholder="HQ"
                  {...createForm.register('site')}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="device-lat">Latitude</Label>
                <Input
                  id="device-lat"
                  placeholder="-33.45"
                  aria-invalid={Boolean(createForm.formState.errors.lat)}
                  {...createForm.register('lat')}
                />
                {createForm.formState.errors.lat ? (
                  <p className="text-xs text-red-400">
                    {createForm.formState.errors.lat.message}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="device-lng">Longitude</Label>
                <Input
                  id="device-lng"
                  placeholder="-70.66"
                  aria-invalid={Boolean(createForm.formState.errors.lng)}
                  {...createForm.register('lng')}
                />
                {createForm.formState.errors.lng ? (
                  <p className="text-xs text-red-400">
                    {createForm.formState.errors.lng.message}
                  </p>
                ) : null}
              </div>
              <Button
                type="submit"
                className="lg:mt-7"
                disabled={createMutation.isPending}
              >
                <Plus className="size-4" />
                {createMutation.isPending ? 'Adding' : 'Add'}
              </Button>
              <div className="lg:col-span-6">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Label>Location</Label>
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
                <MapPicker
                  value={createLocation}
                  onChange={applyCreateLocation}
                  className="h-56"
                />
              </div>
            </form>
            {createMutation.error ? (
              <p className="mt-3 text-sm text-red-400">
                {errorMessage(createMutation.error)}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr] lg:gap-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <CardTitle>Devices</CardTitle>
              <CardDescription>Locks registered in Safelock.</CardDescription>
            </div>
            <Badge variant="outline">{devices.length}</Badge>
          </CardHeader>
          <CardContent className="px-0">
            {devicesQuery.isPending ? (
              <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                Loading devices…
              </p>
            ) : devicesQuery.isError ? (
              <p className="px-6 py-10 text-center text-sm text-red-400">
                {errorMessage(devicesQuery.error)}
              </p>
            ) : devices.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                No devices yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-y border-border text-left text-xs text-muted-foreground">
                      <th className="px-6 py-2 font-medium">Device</th>
                      <th className="px-3 py-2 font-medium">Connectivity</th>
                      <th className="px-3 py-2 font-medium">Access</th>
                      <th className="px-6 py-2 text-right font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((device) => (
                      <tr
                        key={device.id}
                        className="border-b border-border/60 last:border-0"
                      >
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-2.5">
                            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
                              <Cpu className="size-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-medium">
                                {device.name}
                              </p>
                              <p className="font-mono text-xs text-muted-foreground">
                                {device.device_id}
                                {device.site ? ` · ${device.site}` : ''}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-1">
                            <Badge
                              variant={device.online ? 'success' : 'muted'}
                            >
                              {device.online ? 'Online' : 'Offline'}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {device.last_seen
                                ? formatDateTime(device.last_seen)
                                : 'Never connected'}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1.5">
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
                        </td>
                        <td className="px-6 py-3 text-right">
                          <Button
                            variant={
                              selectedId === device.id ? 'secondary' : 'outline'
                            }
                            size="sm"
                            onClick={() => setSelectedId(device.id)}
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
            <CardTitle>{selected ? selected.name : 'Select a device'}</CardTitle>
            <CardDescription>
              {selected
                ? `${selected.device_id} · firmware ${selected.fw ?? 'unknown'} · ACL v${selected.acl_version}`
                : 'Choose a device to review or change its settings.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selected ? (
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap gap-2">
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
                    {selected.locked ? 'Remove remote lock' : 'Lock remotely'}
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
                        {selected.status === 'active' ? 'Retire' : 'Reactivate'}
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

                {isAdmin ? (
                  <form
                    noValidate
                    className="grid gap-3 sm:grid-cols-2"
                    onSubmit={settingsForm.handleSubmit(onSave)}
                  >
                    <div className="grid gap-2">
                      <Label htmlFor="settings-name">Name</Label>
                      <Input
                        id="settings-name"
                        aria-invalid={Boolean(
                          settingsForm.formState.errors.name,
                        )}
                        {...settingsForm.register('name')}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="settings-site">Site</Label>
                      <Input
                        id="settings-site"
                        {...settingsForm.register('site')}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="settings-lat">Latitude</Label>
                      <Input
                        id="settings-lat"
                        aria-invalid={Boolean(
                          settingsForm.formState.errors.lat,
                        )}
                        {...settingsForm.register('lat')}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="settings-lng">Longitude</Label>
                      <Input
                        id="settings-lng"
                        aria-invalid={Boolean(
                          settingsForm.formState.errors.lng,
                        )}
                        {...settingsForm.register('lng')}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <Label>Location on map</Label>
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
                      <MapPicker
                        value={settingsLocation}
                        onChange={applySettingsLocation}
                        className="h-64"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="settings-policy">Offline policy</Label>
                      <Select
                        id="settings-policy"
                        {...settingsForm.register('offline_policy')}
                      >
                        <option value="allow">Allow with cached ACL</option>
                        <option value="deny">Deny without backend</option>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="settings-stale">Stale ACL hours</Label>
                      <Input
                        id="settings-stale"
                        inputMode="numeric"
                        aria-invalid={Boolean(
                          settingsForm.formState.errors.stale_acl_hours,
                        )}
                        {...settingsForm.register('stale_acl_hours')}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="settings-unlock">Unlock duration (ms)</Label>
                      <Input
                        id="settings-unlock"
                        inputMode="numeric"
                        aria-invalid={Boolean(
                          settingsForm.formState.errors.unlock_ms,
                        )}
                        {...settingsForm.register('unlock_ms')}
                      />
                    </div>
                    <label className="flex items-center gap-2 pt-7 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input"
                        {...settingsForm.register('requires_pin')}
                      />
                      Require PIN on this door
                    </label>
                    <div className="sm:col-span-2">
                      <Button
                        type="submit"
                        variant="outline"
                        disabled={updateMutation.isPending}
                      >
                        Save settings
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="grid gap-3 text-sm text-muted-foreground">
                    <MapPicker
                      value={selected.location}
                      onChange={() => undefined}
                      disabled
                      className="h-56"
                    />
                    <div className="grid gap-2">
                      <p>
                        Offline policy: {selected.offline_policy} · stale ACL{' '}
                        {selected.stale_acl_hours} h
                      </p>
                      <p>Unlock duration: {selected.unlock_ms} ms</p>
                      <p>Requires PIN: {selected.requires_pin ? 'yes' : 'no'}</p>
                      <p>
                        Last sync:{' '}
                        {selected.last_sync_at
                          ? formatDateTime(selected.last_sync_at)
                          : 'Never'}
                      </p>
                    </div>
                  </div>
                )}

                {updateMutation.error ? (
                  <p className="text-sm text-red-400">
                    {errorMessage(updateMutation.error)}
                  </p>
                ) : null}
                {deleteMutation.error ? (
                  <p className="text-sm text-red-400">
                    {errorMessage(deleteMutation.error)}
                  </p>
                ) : null}
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
