import { zodResolver } from '@hookform/resolvers/zod'
import { Plus } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'

import { LazyLocationPicker } from '@/components/devices/lazy-location-picker'
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
import type {
  CreateDeviceInput,
  Device,
  DeviceLocation,
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

type CreateValues = z.infer<typeof createSchema>

type DeviceCreateFormProps = {
  onCreate: (input: CreateDeviceInput) => Promise<Device>
  onCancel: () => void
  isPending: boolean
  error: string | null
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

function locationFrom(lat: string, lng: string) {
  return lat === '' ? null : { lat: Number(lat), lng: Number(lng) }
}

export function DeviceCreateForm({
  onCreate,
  onCancel,
  isPending,
  error,
}: DeviceCreateFormProps) {
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      device_id: '',
      name: '',
      site: '',
      lat: '',
      lng: '',
    },
  })
  const lat = useWatch({ control: form.control, name: 'lat' })
  const lng = useWatch({ control: form.control, name: 'lng' })
  const location = parseLocation(lat, lng)

  function applyLocation(next: DeviceLocation | null) {
    form.setValue('lat', next ? String(next.lat) : '', { shouldValidate: true })
    form.setValue('lng', next ? String(next.lng) : '', { shouldValidate: true })
  }

  async function onSubmit(values: CreateValues) {
    try {
      await onCreate({
        device_id: values.device_id.toLowerCase(),
        name: values.name,
        site: values.site === '' ? null : values.site,
        location: locationFrom(values.lat, values.lng),
      })
      form.reset()
    } catch {
      // The mutation error is rendered below the form.
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add device</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <FormField
            label="Device ID"
            htmlFor="device-id"
            error={form.formState.errors.device_id?.message}
          >
            <Input
              placeholder="sl-0001"
              {...form.register('device_id')}
            />
          </FormField>
          <FormField
            label="Name"
            htmlFor="device-name"
            error={form.formState.errors.name?.message}
          >
            <Input
              placeholder="Front door"
              {...form.register('name')}
            />
          </FormField>
          <FormField label="Site (optional)" htmlFor="device-site">
            <Input placeholder="HQ" {...form.register('site')} />
          </FormField>
          <div className="sm:col-span-2">
            <p className="mb-2 text-sm font-medium">Location on map</p>
            <LazyLocationPicker
              value={location}
              onChange={applyLocation}
              className="h-[448px] w-full"
            />
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <FormField
                label="Latitude"
                htmlFor="device-lat"
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
                htmlFor="device-lng"
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
          <FormActions className="mt-4 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              <Plus className="size-4" />
              {isPending ? 'Adding…' : 'Add device'}
            </Button>
          </FormActions>
        </form>
        <InlineNotice message={error} className="mt-3" />
      </CardContent>
    </Card>
  )
}
