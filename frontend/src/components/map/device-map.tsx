import { useEffect } from 'react'
import L from 'leaflet'
import { MapPin } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  AttributionControl,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet'

import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button-variants'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Device } from '@/types/device'
import { ATTRIBUTION, TILE_URL, pinIcon } from './map-config'

function markerColor(device: Device) {
  if (device.locked) return '#ef4444'
  if (!device.online) return '#71717a'
  return '#22c55e'
}

function FitDevices({
  devices,
  fitRequest,
}: {
  devices: Device[]
  fitRequest: number
}) {
  const map = useMap()

  useEffect(() => {
    const points = devices.flatMap((device) =>
      device.location
        ? [[device.location.lat, device.location.lng] as [number, number]]
        : [],
    )

    if (points.length === 0) return
    if (points.length === 1) {
      map.setView(points[0], 13)
      return
    }
    map.fitBounds(L.latLngBounds(points), {
      padding: [48, 48],
      maxZoom: 13,
    })
  }, [devices, fitRequest, map])

  return null
}

type DeviceMapProps = {
  devices: Device[]
  fitRequest: number
}

export function DeviceMap({ devices, fitRequest }: DeviceMapProps) {
  return (
    <div className="relative isolate h-full w-full">
      <MapContainer
        center={[20, 0]}
        zoom={2}
        minZoom={2}
        maxZoom={18}
        scrollWheelZoom={false}
        worldCopyJump
        attributionControl={false}
        className="h-full w-full"
      >
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
        <AttributionControl position="bottomright" prefix={false} />
        <FitDevices devices={devices} fitRequest={fitRequest} />
        {devices.map((device) =>
          device.location ? (
            <Marker
              key={device.id}
              position={[device.location.lat, device.location.lng]}
              icon={pinIcon(markerColor(device))}
            >
              <Popup>
                <div className="space-y-2">
                  <div>
                    <p className="text-sm font-medium">{device.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {device.device_id} · {device.site ?? 'No site'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={device.online ? 'success' : 'muted'}>
                      {device.online ? 'Online' : 'Offline'}
                    </Badge>
                    <Badge variant={device.locked ? 'danger' : 'outline'}>
                      {device.locked ? 'Locked (remote)' : 'Unlocked'}
                    </Badge>
                    {device.requires_pin ? (
                      <Badge variant="secondary">PIN</Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Last seen{' '}
                    {device.last_seen
                      ? formatDateTime(device.last_seen)
                      : 'Never'}
                  </p>
                  <Link
                    to={`/devices?device=${encodeURIComponent(device.device_id)}`}
                    className="text-xs underline underline-offset-4"
                  >
                    Manage device
                  </Link>
                </div>
              </Popup>
            </Marker>
          ) : null,
        )}
      </MapContainer>

      {devices.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-[1000] grid place-items-center p-6">
          <div className="pointer-events-auto max-w-xs rounded-xl border border-border bg-zinc-950/90 p-5 text-center shadow-xl backdrop-blur">
            <MapPin className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No devices yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add your first device and set its location to see it here.
            </p>
            <Link
              to="/devices"
              className={cn(buttonVariants({ size: 'sm' }), 'mt-4 inline-flex')}
            >
              Add device
            </Link>
          </div>
        </div>
      ) : null}

      <div className="absolute bottom-4 left-4 z-[1000] flex items-center gap-3 rounded-md border border-border bg-zinc-950/90 px-3 py-1.5 text-[11px] text-muted-foreground backdrop-blur">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-500" />
          Online
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-zinc-500" />
          Offline
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-red-500" />
          Locked
        </span>
      </div>
    </div>
  )
}
