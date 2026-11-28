import { useEffect, type ReactNode } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Lock, LockOpen, RefreshCw, X } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'

import { LazyLocationPicker } from '@/components/devices/lazy-location-picker'
import { deviceMarkerColor } from '@/components/map/map-config'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { EventTime } from '@/components/ui/event-time'
import { FormActions } from '@/components/ui/form-actions'
import { FormField } from '@/components/ui/form-field'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useConfirm } from '@/hooks/use-confirm'
import type {
  Device,
  DeviceLocation,
  DeviceStatus,
  UpdateDeviceInput,
} from '@/lib/api'

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
      .refine((value) => Number(value) >= 100 && Number(value) <= 10_000, {
        message: 'Use 100 to 10000 ms',
      }),
  })
  .refine((values) => (values.lat === '') === (values.lng === ''), {
    message: 'Set both latitude and longitude, or neither',
    path: ['lng'],
  })

type SettingsValues = z.infer<typeof settingsSchema>

type DeviceDetailPanelProps = {
  device: Device | null
  isAdmin: boolean
  pending: {
    update: boolean
    delete: boolean
    sync: boolean
    unlock: boolean
  }
  error: string | null
  successMessage: string | null
  settingsSuccessMessage: string | null
  onClose: () => void
  onUpdate: (input: UpdateDeviceInput) => void
  onSaveSettings: (input: UpdateDeviceInput) => Promise<Device>
  onRevertSettings: () => void
  onDelete: () => void
  onSync: () => void
  onUnlock: () => void
}

function StatusTile({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
        {children}
      </div>
    </div>
  )
}

function StatusRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-2.5 first:pt-3 last:pb-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm">{children}</dd>
    </div>
  )
}

function valuesFrom(device: Device): SettingsValues {
  return {
    name: device.name,
    site: device.site ?? '',
    lat: device.location ? String(device.location.lat) : '',
    lng: device.location ? String(device.location.lng) : '',
    offline_policy: device.offline_policy,
    stale_acl_hours: String(device.stale_acl_hours),
    unlock_ms: String(device.unlock_ms),
  }
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

type DeviceSettingsFormProps = {
  device: Device
  pending: boolean
  successMessage: string | null
  onSave: (input: UpdateDeviceInput) => Promise<Device>
  onRevert: () => void
}

function DeviceSettingsForm({
  device,
  pending,
  successMessage,
  onSave,
  onRevert,
}: DeviceSettingsFormProps) {
  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: valuesFrom(device),
  })
  const lat = useWatch({ control: form.control, name: 'lat' })
  const lng = useWatch({ control: form.control, name: 'lng' })
  const location = parseLocation(lat, lng)

  useEffect(() => {
    form.reset(valuesFrom(device))
    // Reset only when switching devices, not after a background refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.id])

  function applyLocation(next: DeviceLocation | null) {
    form.setValue('lat', next ? String(next.lat) : '', {
      shouldValidate: true,
      shouldDirty: true,
    })
    form.setValue('lng', next ? String(next.lng) : '', {
      shouldValidate: true,
      shouldDirty: true,
    })
  }

  async function onSubmit(values: SettingsValues) {
    try {
      const updated = await onSave({
        name: values.name,
        site: values.site === '' ? null : values.site,
        location: locationFrom(values.lat, values.lng),
        offline_policy: values.offline_policy,
        stale_acl_hours: Number(values.stale_acl_hours),
        unlock_ms: Number(values.unlock_ms),
      })
      form.reset(valuesFrom(updated))
    } catch {
      // The mutation error is rendered below the form.
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4 border-t border-border pt-5"
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <h3 className="text-sm font-medium">Settings</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Name"
          htmlFor="settings-name"
          error={form.formState.errors.name?.message}
        >
          <Input {...form.register('name')} />
        </FormField>
        <FormField label="Site" htmlFor="settings-site">
          <Input {...form.register('site')} />
        </FormField>
        <FormField label="Offline policy" htmlFor="settings-policy">
          <Select {...form.register('offline_policy')}>
            <option value="allow">Allow with cached ACL</option>
            <option value="deny">Deny without backend</option>
          </Select>
        </FormField>
        <FormField
          label="Stale ACL hours"
          htmlFor="settings-stale"
          error={form.formState.errors.stale_acl_hours?.message}
        >
          <Input
            inputMode="numeric"
            {...form.register('stale_acl_hours')}
          />
        </FormField>
        <FormField
          label="Unlock duration (ms)"
          htmlFor="settings-unlock"
          error={form.formState.errors.unlock_ms?.message}
        >
          <Input inputMode="numeric" {...form.register('unlock_ms')} />
        </FormField>
        <div className="sm:col-span-2">
          <p className="mb-2 text-sm font-medium">Location on map</p>
          <LazyLocationPicker
            value={location}
            onChange={applyLocation}
            markerColor={deviceMarkerColor(device)}
            className="h-64"
          />
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <FormField
              label="Latitude"
              htmlFor="settings-lat"
              error={form.formState.errors.lat?.message}
              reserveMessage={false}
            >
              <Input
                inputMode="decimal"
                placeholder="-33.45"
                {...form.register('lat')}
              />
            </FormField>
            <FormField
              label="Longitude"
              htmlFor="settings-lng"
              error={form.formState.errors.lng?.message}
              reserveMessage={false}
            >
              <Input
                inputMode="decimal"
                placeholder="-70.66"
                {...form.register('lng')}
              />
            </FormField>
          </div>
          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={location === null}
              onClick={() => applyLocation(null)}
            >
              Clear location
            </Button>
          </div>
        </div>
      </div>
      <InlineNotice tone="success" message={successMessage} />
      <FormActions className="mt-4">
        <Button
          type="button"
          variant="ghost"
          disabled={pending || !form.formState.isDirty}
          onClick={() => {
            form.reset(valuesFrom(device))
            onRevert()
          }}
        >
          Revert changes
        </Button>
        <Button type="submit" disabled={pending}>
          Save settings
        </Button>
      </FormActions>
    </form>
  )
}

export function DeviceDetailPanel({
  device,
  isAdmin,
  pending,
  error,
  successMessage,
  settingsSuccessMessage,
  onClose,
  onUpdate,
  onSaveSettings,
  onRevertSettings,
  onDelete,
  onSync,
  onUnlock,
}: DeviceDetailPanelProps) {
  const { confirm, dialog } = useConfirm()

  if (device === null) {
    return (
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <CardTitle>Select a device</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col">
          <InlineNotice
            tone="success"
            className="mb-4"
            message={successMessage}
          />
          <p className="flex items-center justify-center py-10 text-center text-sm text-muted-foreground">
            Pick a device from the list.
          </p>
        </CardContent>
      </Card>
    )
  }

  const status: DeviceStatus = device.status

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <CardTitle className="break-words leading-snug">
            {device.name}
          </CardTitle>
        </div>
        <Button
          className="shrink-0"
          variant="ghost"
          size="icon"
          aria-label="Close details"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col">
        <div className="flex flex-col gap-6">
          <section aria-label="Device status">
            <dl className="divide-y divide-border rounded-lg border border-border px-4">
              <StatusRow label="Connection">
                <Badge variant={device.online ? 'success' : 'muted'}>
                  {device.online ? 'Online' : 'Offline'}
                </Badge>
              </StatusRow>
              <StatusRow label="Device ID">
                <span className="break-all font-mono">
                  {device.device_id}
                </span>
              </StatusRow>
              <StatusRow label="Firmware">
                <span className="font-mono">{device.fw ?? 'Unknown'}</span>
              </StatusRow>
              <StatusRow label="Last seen">
                <span className="text-muted-foreground">
                  {device.last_seen ? (
                    <EventTime value={device.last_seen} />
                  ) : (
                    'Never connected'
                  )}
                </span>
              </StatusRow>
              <StatusRow label="Access list">
                <span className="text-muted-foreground">
                  v{device.acl_version} ·{' '}
                  {device.last_sync_at ? (
                    <EventTime value={device.last_sync_at} />
                  ) : (
                    'Never synced'
                  )}
                </span>
              </StatusRow>
            </dl>
          </section>

          <section className="border-t border-border pt-5">
            <h3 className="text-sm font-medium">Actions</h3>
            <p className="mt-3 text-xs text-muted-foreground">Operation</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant={device.locked ? 'secondary' : 'danger'}
                size="sm"
                title={
                  device.locked
                    ? 'Allow access again'
                    : 'Deny all access while enabled'
                }
                disabled={pending.update}
                onClick={() =>
                  confirm({
                    title: device.locked
                      ? 'Disable remote lock?'
                      : 'Enable remote lock?',
                    description: device.locked
                      ? 'Access will follow the device configuration again.'
                      : 'All access will be denied while the lock is enabled.',
                    confirmLabel: device.locked
                      ? 'Disable lock'
                      : 'Enable lock',
                    onConfirm: () =>
                      onUpdate({ locked: !device.locked }),
                  })
                }
              >
                {device.locked ? (
                  <LockOpen className="size-4" />
                ) : (
                  <Lock className="size-4" />
                )}
                {device.locked
                  ? 'Disable remote lock'
                  : 'Enable remote lock'}
              </Button>
              {isAdmin ? (
                <Button
                  variant="outline"
                  size="sm"
                  title={
                    device.online
                      ? 'Send the full access list now'
                      : 'The device must be online to receive the access list'
                  }
                  disabled={!device.online || pending.sync}
                  onClick={() =>
                    confirm({
                      title: 'Synchronize access list?',
                      description: `${device.device_id} will receive the full configuration and access list now.`,
                      confirmLabel: 'Sync',
                      onConfirm: onSync,
                    })
                  }
                >
                  <RefreshCw className="size-4" />
                  {pending.sync ? 'Syncing ACL...' : 'Sync ACL'}
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                title={
                  device.online
                    ? 'Send a remote unlock command'
                    : 'The device must be online to unlock remotely'
                }
                disabled={!device.online || pending.unlock}
                onClick={() =>
                  confirm({
                    title: 'Unlock remotely?',
                    description: `${device.device_id} will open for a few seconds and the action will be audited.`,
                    confirmLabel: 'Unlock',
                    onConfirm: onUnlock,
                  })
                }
              >
                <LockOpen className="size-4" />
                {pending.unlock ? 'Unlocking...' : 'Unlock'}
              </Button>
            </div>
            {isAdmin ? (
              <>
                <p className="mt-4 text-xs text-muted-foreground">
                  Configuration
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    variant={
                      device.requires_pin ? 'secondary' : 'outline'
                    }
                    size="sm"
                    title={
                      device.requires_pin
                        ? 'Removing PIN allows offline card access'
                        : 'PIN-enabled doors are online-only'
                    }
                    aria-label={
                      device.requires_pin
                        ? 'Remove PIN requirement'
                        : 'Require PIN'
                    }
                    disabled={pending.update}
                    onClick={() =>
                      confirm({
                        title: device.requires_pin
                          ? 'Remove PIN requirement?'
                          : 'Require PIN?',
                        description: device.requires_pin
                          ? 'Card access will work offline again.'
                          : 'This door will be online-only: access will be denied without the backend.',
                        confirmLabel: device.requires_pin
                          ? 'Remove PIN'
                          : 'Require PIN',
                        onConfirm: () =>
                          onUpdate({
                            requires_pin: !device.requires_pin,
                          }),
                      })
                    }
                  >
                    {device.requires_pin ? 'Remove PIN' : 'Require PIN'}
                  </Button>
                  <Button
                    variant={
                      status === 'active' ? 'outline' : 'secondary'
                    }
                    size="sm"
                    disabled={pending.update}
                    onClick={() =>
                      confirm({
                        title:
                          status === 'active'
                            ? 'Retire device?'
                            : 'Reactivate device?',
                        description:
                          status === 'active'
                            ? 'The device will keep its history but stop operating.'
                            : 'The device will be able to operate again.',
                        confirmLabel:
                          status === 'active' ? 'Retire' : 'Reactivate',
                        onConfirm: () =>
                          onUpdate({
                            status:
                              status === 'active' ? 'retired' : 'active',
                          }),
                      })
                    }
                  >
                    {status === 'active' ? 'Retire' : 'Reactivate'}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={pending.delete}
                    onClick={() =>
                      confirm({
                        title: 'Delete device?',
                        description: `${device.device_id} can only be deleted if it never connected and has no history.`,
                        confirmLabel: 'Delete',
                        onConfirm: onDelete,
                      })
                    }
                  >
                    Delete permanently
                  </Button>
                </div>
              </>
            ) : null}
            <InlineNotice
              tone="success"
              message={successMessage}
              className="mt-3"
            />
            <InlineNotice message={error} className="mt-3" />
          </section>

          {isAdmin ? (
            <DeviceSettingsForm
              device={device}
              pending={pending.update}
              successMessage={settingsSuccessMessage}
              onSave={onSaveSettings}
              onRevert={onRevertSettings}
            />
          ) : (
            <section className="flex flex-col gap-4 border-t border-border pt-5">
              <h3 className="text-sm font-medium">Settings</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <StatusTile label="Offline policy">
                  <span className="text-sm">
                    {device.offline_policy === 'allow'
                      ? 'Allow with cached ACL'
                      : 'Deny without backend'}
                  </span>
                </StatusTile>
                <StatusTile label="Stale ACL">
                  <span className="text-sm">{device.stale_acl_hours} h</span>
                </StatusTile>
                <StatusTile label="Unlock duration">
                  <span className="text-sm">{device.unlock_ms} ms</span>
                </StatusTile>
                <StatusTile label="PIN required">
                  <Badge
                    variant={device.requires_pin ? 'secondary' : 'muted'}
                  >
                    {device.requires_pin ? 'Yes (online only)' : 'No'}
                  </Badge>
                </StatusTile>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Location on map</p>
                <LazyLocationPicker
                  value={device.location}
                  onChange={() => undefined}
                  disabled
                  markerColor={deviceMarkerColor(device)}
                  className="h-56"
                />
              </div>
            </section>
          )}
        </div>
      </CardContent>
      {dialog}
    </Card>
  )
}
