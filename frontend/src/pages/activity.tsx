import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { TableSkeleton } from '@/components/ui/skeleton'
import { useAccessEvents } from '@/hooks/use-access-events'
import { useDevices } from '@/hooks/use-devices'
import { ApiError, type AccessDecision } from '@/lib/api'
import { formatDateTime } from '@/lib/format'

const REASON_LABELS: Record<string, string> = {
  acl_match: 'Card in access list',
  acl_absent: 'Card not in access list',
  acl_stale: 'Access list too old',
  expired: 'Credential expired',
  not_yet_valid: 'Credential not valid yet',
  offline_no_pin: 'PIN needs the backend',
  door_locked: 'Door locked remotely',
  pin_ok: 'PIN accepted',
  pin_bad: 'PIN rejected',
  pin_locked: 'PIN temporarily locked',
  no_pin_set: 'No PIN configured',
  rtc_invalid: 'Device clock invalid',
  backend_unreachable: 'Backend unreachable',
  remote: 'Remote unlock',
  manual_open: 'Manual opening',
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'Something went wrong. Try again.'
}

function DecisionBadge({ decision }: { decision: AccessDecision }) {
  if (decision === 'granted') return <Badge variant="success">Granted</Badge>
  if (decision === 'denied') return <Badge variant="danger">Denied</Badge>
  return <Badge variant="muted">Unknown</Badge>
}

export function ActivityPage() {
  const [limit, setLimit] = useState(50)
  const [offset, setOffset] = useState(0)
  const [deviceId, setDeviceId] = useState('')

  const devicesQuery = useDevices()
  const eventsQuery = useAccessEvents({ limit, offset, deviceId: deviceId || undefined })
  const devices = devicesQuery.data ?? []
  const items = eventsQuery.data?.items ?? []
  const total = eventsQuery.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / limit))

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Activity</CardTitle>
          <CardDescription>
            Access decisions reported by the devices.
          </CardDescription>
        </div>
        <Badge variant="outline" className="tabular-nums">
          {total} events
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid w-56 gap-2">
            <Label htmlFor="activity-device">Device</Label>
            <Select
              id="activity-device"
              value={deviceId}
              onChange={(event) => {
                setDeviceId(event.target.value)
                setOffset(0)
              }}
            >
              <option value="">All devices</option>
              {devices.map((device) => (
                <option key={device.id} value={device.device_id}>
                  {device.name} ({device.device_id})
                </option>
              ))}
            </Select>
          </div>
          <div className="grid w-28 gap-2">
            <Label htmlFor="activity-limit">Per page</Label>
            <Select
              id="activity-limit"
              value={limit}
              onChange={(event) => {
                setLimit(Number(event.target.value))
                setOffset(0)
              }}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </Select>
          </div>
        </div>

        {eventsQuery.isPending ? (
          <TableSkeleton columns={7} />
        ) : eventsQuery.isError ? (
          <p className="py-12 text-center text-sm text-destructive">
            {errorMessage(eventsQuery.error)}
          </p>
        ) : items.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No access events yet.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-y border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Device</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Decision</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">Card</th>
                  <th className="py-2 pl-3 text-right font-medium">ACL</th>
                </tr>
              </thead>
              <tbody>
                {items.map((event) => (
                  <tr
                    key={event.id}
                    className="border-b border-border/60 align-top last:border-0"
                  >
                    <td className="py-3 pr-3 whitespace-nowrap text-muted-foreground">
                      {formatDateTime(event.ts)}
                      {event.degraded ? (
                        <Badge variant="muted" className="ml-2">
                          degraded
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {devices.find((device) => device.device_id === event.device_id)
                        ?.name ?? (
                        <span className="font-mono">{event.device_id}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 capitalize">{event.source}</td>
                    <td className="px-3 py-3">
                      <DecisionBadge decision={event.decision} />
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {REASON_LABELS[event.reason] ?? event.reason}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">{event.uid ?? '—'}</td>
                    <td className="py-3 pl-3 text-right tabular-nums text-muted-foreground">
                      {event.acl_age_s === null ? '—' : `${event.acl_age_s}s`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > limit ? (
          <div className="mt-4 flex items-center justify-end gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              Previous
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">
              Page {Math.floor(offset / limit) + 1} of {pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + limit >= total}
              onClick={() => setOffset(offset + limit)}
            >
              Next
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
