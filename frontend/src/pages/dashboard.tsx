import { lazy, Suspense, useState } from 'react'
import { ChevronRight, Maximize2 } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { EventTime } from '@/components/ui/event-time'
import { Skeleton } from '@/components/ui/skeleton'
import { useAccessEvents } from '@/hooks/use-access-events'
import { useDevices } from '@/hooks/use-devices'

const DeviceMap = lazy(async () => {
  const module = await import('@/components/map/device-map')
  return { default: module.DeviceMap }
})

export function DashboardPage() {
  const [fitRequest, setFitRequest] = useState(0)
  const devicesQuery = useDevices()
  const eventsQuery = useAccessEvents({ limit: 5 })
  const devices = (devicesQuery.data ?? []).filter(
    (device) => device.status === 'active',
  )
  const hasLocations = devices.some((device) => device.location !== null)
  const recentEvents = eventsQuery.data?.items ?? []

  return (
    <div className="flex min-h-full flex-col gap-4 lg:gap-6">
      <section className="grid flex-1 gap-4 lg:grid-cols-3 lg:gap-6">
        <Card className="flex h-full gap-4 overflow-hidden pb-0 lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <CardTitle>Lock locations</CardTitle>
              <CardDescription>
                Devices with a saved location.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFitRequest((value) => value + 1)}
              disabled={!hasLocations}
            >
              <Maximize2 className="size-4" />
              Fit
            </Button>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col px-0">
            <div className="relative min-h-[320px] flex-1 border-t border-border">
              <Suspense
                fallback={<Skeleton className="absolute inset-0 rounded-none" />}
              >
                <DeviceMap devices={devices} fitRequest={fitRequest} />
              </Suspense>
            </div>
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardHeader className="flex-row items-center justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>Last access decisions.</CardDescription>
            </div>
            <Link
              to="/activity"
              className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              View all
              <ChevronRight className="size-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3 pb-6">
            {recentEvents.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No access events yet.
              </p>
            ) : (
              recentEvents.map((event) => (
                <div
                  key={event.id}
                  className="flex items-start justify-between gap-3 border-b border-border/60 pb-2 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      {devices.find((device) => device.device_id === event.device_id)
                        ?.name ?? (
                        <span className="font-mono">{event.device_id}</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <EventTime value={event.ts} /> · {event.reason}
                    </p>
                  </div>
                  <Badge
                    variant={
                      event.decision === 'granted'
                        ? 'success'
                        : event.decision === 'denied'
                          ? 'danger'
                          : 'muted'
                    }
                  >
                    {event.decision}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
