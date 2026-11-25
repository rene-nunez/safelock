import { useEffect, useRef } from 'react'
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
import { EventTime } from '@/components/ui/event-time'
import { cn } from '@/lib/utils'
import type { Device } from '@/types/device'
import {
  ATTRIBUTION,
  TILE_URL,
  deviceMarkerColor,
  pinIcon,
} from './map-config'

function FitDevices({
  devices,
  fitRequest,
}: {
  devices: Device[]
  fitRequest: number
}) {
  const map = useMap()
  const points = devices.flatMap((device) =>
    device.location
      ? [[device.location.lat, device.location.lng] as [number, number]]
      : [],
  )
  const locationsKey = points.map(([lat, lng]) => `${lat},${lng}`).join(';')
  const pointsRef = useRef(points)

  useEffect(() => {
    pointsRef.current = points
  })

  useEffect(() => {
    const latestPoints = pointsRef.current
    if (latestPoints.length === 0) return
    if (latestPoints.length === 1) {
      map.setView(latestPoints[0], 16)
      return
    }
    map.fitBounds(L.latLngBounds(latestPoints), {
      padding: [48, 48],
      maxZoom: 16,
    })
  }, [locationsKey, fitRequest, map])

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
        scrollWheelZoom={true}
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
              icon={pinIcon(deviceMarkerColor(device))}
            >
              <Popup>
                <div className="space-y-2">
                  <div>
                    <p className="text-sm font-medium">{device.name}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{device.device_id}</span> ·{' '}
                      {device.site ?? 'No site'}
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
                    {device.last_seen ? (
                      <EventTime value={device.last_seen} />
                    ) : (
                      'Never'
                    )}
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
          <div className="pointer-events-auto max-w-xs rounded-xl border border-border bg-background/90 p-5 text-center shadow-xl backdrop-blur">
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

      <div className="absolute bottom-4 left-4 z-[1000] flex items-center gap-3 rounded-md border border-border bg-background/90 px-3 py-1.5 text-[11px] text-muted-foreground backdrop-blur">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-success" />
          Online
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-muted-foreground" />
          Offline
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-destructive" />
          Locked
        </span>
      </div>
    </div>
  )
}
