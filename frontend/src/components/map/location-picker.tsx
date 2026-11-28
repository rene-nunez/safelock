import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { Crosshair } from 'lucide-react'
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

const DEFAULT_CENTER: [number, number] = [37.422, -122.0841]
const DEFAULT_ZOOM = 16
const PICKED_ZOOM = 17

function roundCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function MapBridge({ onReady }: { onReady: (map: L.Map) => void }) {
  const map = useMap()

  useEffect(() => {
    onReady(map)
  }, [map, onReady])

  return null
}

function MapInteractionTracker({ onInteract }: { onInteract: () => void }) {
  useMapEvents({
    click: onInteract,
    mousedown: onInteract,
    dragstart: onInteract,
    zoomstart: onInteract,
  })

  return null
}

function LocationHandler({
  value,
  onChange,
  disabled,
  markerColor,
}: {
  value: DeviceLocation | null
  onChange: (value: DeviceLocation) => void
  disabled: boolean
  markerColor: string | undefined
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
      icon={pinIcon(markerColor ?? (disabled ? 'var(--muted-foreground)' : 'var(--success)'))}
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

type LocationPickerProps = {
  value: DeviceLocation | null
  onChange: (value: DeviceLocation | null) => void
  disabled?: boolean
  markerColor?: string
  className?: string
}

export function LocationPicker({
  value,
  onChange,
  disabled = false,
  markerColor,
  className = 'h-64',
}: LocationPickerProps) {
  const mapRef = useRef<L.Map | null>(null)
  const [interacted, setInteracted] = useState(false)
  const markInteracted = useCallback(() => setInteracted(true), [])
  const handleMapReady = useCallback((map: L.Map) => {
    mapRef.current = map
  }, [])

  function centerOnLocation() {
    const map = mapRef.current
    if (map === null || value === null) return
    map.flyTo([value.lat, value.lng], Math.max(map.getZoom(), PICKED_ZOOM))
  }

  return (
    <div
      className={`relative isolate w-full overflow-hidden rounded-lg border border-border ${className}`}
    >
      <MapContainer
        center={value ? [value.lat, value.lng] : DEFAULT_CENTER}
        zoom={value ? PICKED_ZOOM : DEFAULT_ZOOM}
        minZoom={2}
        maxZoom={18}
        scrollWheelZoom={true}
        worldCopyJump
        attributionControl={false}
        className="h-full w-full"
      >
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
        <AttributionControl position="bottomright" prefix={false} />
        <MapBridge onReady={handleMapReady} />
        <MapInteractionTracker onInteract={markInteracted} />
        <LocationHandler
          value={value}
          onChange={onChange}
          disabled={disabled}
          markerColor={markerColor}
        />
      </MapContainer>

      <button
        type="button"
        aria-label="Center on location"
        title="Center on location"
        disabled={disabled || value === null}
        onClick={centerOnLocation}
        className="absolute right-3 top-3 z-[1000] flex size-9 items-center justify-center rounded-md border border-border bg-background/90 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 disabled:pointer-events-none disabled:opacity-50"
      >
        <Crosshair className="size-4" />
      </button>

      {value === null && (disabled || !interacted) ? (
        <div className="pointer-events-none absolute inset-0 z-[1000] grid place-items-center p-4">
          <div className="rounded-lg border border-border bg-background/85 px-4 py-3 text-center text-xs text-muted-foreground backdrop-blur">
            {disabled
              ? 'No location set.'
              : 'Click the map to place the lock, then drag the marker to adjust.'}
          </div>
        </div>
      ) : null}
    </div>
  )
}
