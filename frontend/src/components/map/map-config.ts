import L from 'leaflet'

import type { Device } from '@/lib/api'

export const TILE_URL =
  'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png'

export const ATTRIBUTION =
  '&copy; <a href="https://stadiamaps.com/" target="_blank" rel="noreferrer">Stadia Maps</a> ' +
  '&copy; <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> ' +
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'

export function pinIcon(color: string) {
  return L.divIcon({
    className: 'device-marker-wrapper',
    html: `<span class="device-marker" style="--marker-color:${color}"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
}

export function deviceMarkerColor(device: Device): string {
  if (device.locked) return '#ef4444'
  if (!device.online) return '#71717a'
  return '#22c55e'
}
