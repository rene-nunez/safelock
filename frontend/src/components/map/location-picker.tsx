import { useEffect, useState } from 'react'
import L from 'leaflet'
import {
  AttributionControl,
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'

import { ATTRIBUTION, TILE_URL, pinIcon } from './map-config'
import type { DeviceLocation } from '@/lib/api'

const DEFAULT_CENTER: [number, number] = [-33.4489, -70.6693]
const DEFAULT_ZOOM = 12
const PICKED_ZOOM = 14

function roundCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function LocationHandler({
  value,
  onChange,
  disabled,
}: {
  value: DeviceLocation | null
  onChange: (value: DeviceLocation) => void
  disabled: boolean
}) {
  const map = useMap()
  const lat = value?.lat
  const lng = value?.lng

  useMapEvents({
    click(event) {
      if (disabled) return
      onChange({
        lat: roundCoordinate(event.latlng.lat),
        lng: roundCoordinate(event.latlng.lng),
      })
    },
  })

  useEffect(() => {
    if (lat === undefined || lng === undefined) return
    map.setView([lat, lng], Math.max(map.getZoom(), PICKED_ZOOM))
  }, [lat, lng, map])

  if (value === null) return null

  return (
    <Marker
      position={[value.lat, value.lng]}
      draggable={!disabled}
      icon={pinIcon(disabled ? '#71717a' : '#22c55e')}
      eventHandlers={{
        dragend(event) {
          const position = (event.target as L.Marker).getLatLng()
          onChange({
            lat: roundCoordinate(position.lat),
            lng: roundCoordinate(position.lng),
          })
        },
      }}
    />
  )
}

function ScrollZoomToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean
  onToggle: () => void
}) {
  const map = useMap()

  useEffect(() => {
    if (enabled) {
      map.scrollWheelZoom.enable()
    } else {
      map.scrollWheelZoom.disable()
    }
  }, [enabled, map])

  return (
    <div
      className="absolute right-2 top-2 z-[1000]"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-pressed={enabled}
        onClick={onToggle}
        className="rounded-md border border-border bg-zinc-950/90 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        Scroll zoom {enabled ? 'on' : 'off'}
      </button>
    </div>
  )
}

type LocationPickerProps = {
  value: DeviceLocation | null
  onChange: (value: DeviceLocation | null) => void
  disabled?: boolean
  className?: string
}

export function LocationPicker({
  value,
  onChange,
  disabled = false,
  className = 'h-64',
}: LocationPickerProps) {
  const [scrollZoom, setScrollZoom] = useState(false)

  return (
    <div
      className={`relative isolate w-full overflow-hidden rounded-lg border border-border ${className}`}
    >
      <MapContainer
        center={value ? [value.lat, value.lng] : DEFAULT_CENTER}
        zoom={value ? PICKED_ZOOM : DEFAULT_ZOOM}
        minZoom={2}
        maxZoom={18}
        scrollWheelZoom={false}
        worldCopyJump
        attributionControl={false}
        className="h-full w-full"
      >
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
        <AttributionControl position="bottomright" prefix={false} />
        <ScrollZoomToggle
          enabled={scrollZoom}
          onToggle={() => setScrollZoom((current) => !current)}
        />
        <LocationHandler
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      </MapContainer>

      {value === null ? (
        <div className="pointer-events-none absolute inset-0 z-[1000] grid place-items-center p-4">
          <div className="rounded-lg border border-border bg-zinc-950/85 px-4 py-3 text-center text-xs text-muted-foreground backdrop-blur">
            {disabled
              ? 'No location set.'
              : 'Click the map to place the lock, then drag the marker to adjust.'}
          </div>
        </div>
      ) : null}
    </div>
  )
}
