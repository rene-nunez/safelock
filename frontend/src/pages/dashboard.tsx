import { lazy, Suspense, useState } from 'react'
import {
  Activity,
  Cpu,
  Lock,
  Maximize2,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useAccessEvents } from '@/hooks/use-access-events'
import { useDevices } from '@/hooks/use-devices'
import { formatDateTime } from '@/lib/format'

const DeviceMap = lazy(async () => {
  const module = await import('@/components/map/device-map')
  return { default: module.DeviceMap }
})

type StatCardProps = {
  label: string
  value: string
  hint: string
  icon: LucideIcon
}

function StatCard({ label, value, hint, icon: Icon }: StatCardProps) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="flex items-start justify-between gap-3 px-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
          <Icon className="size-4" />
        </span>
      </CardContent>
    </Card>
  )
}

export function DashboardPage() {
  const [fitRequest, setFitRequest] = useState(0)
  const devicesQuery = useDevices()
  const eventsQuery = useAccessEvents({ limit: 5 })
  const devices = (devicesQuery.data ?? []).filter(
    (device) => device.status === 'active',
  )
  const online = devices.filter((device) => device.online).length
  const locked = devices.filter((device) => device.locked).length
  const hasLocations = devices.some((device) => device.location !== null)
  const accessToday = eventsQuery.data?.today_count ?? 0
  const recentEvents = eventsQuery.data?.items ?? []

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Online devices"
          value={`${online} / ${devices.length}`}
          hint="Connected to the backend"
          icon={Cpu}
        />
        <StatCard
          label="Doors locked"
          value={`${locked}`}
          hint="Blocked remotely"
          icon={Lock}
        />
        <StatCard
          label="Access today"
          value={`${accessToday}`}
          hint="Access decisions reported"
          icon={Activity}
        />
        <StatCard
          label="Pending enrollments"
          value="—"
          hint="No enrollment in progress"
          icon={UserPlus}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        <Card className="gap-4 overflow-hidden lg:col-span-2">
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
          <CardContent className="px-0">
            <div className="h-[360px] border-t border-border sm:h-[420px]">
              <Suspense
                fallback={<div className="h-full w-full animate-pulse bg-secondary/40" />}
              >
                <DeviceMap devices={devices} fitRequest={fitRequest} />
              </Suspense>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Last access decisions.</CardDescription>
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
                        ?.name ?? event.device_id}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(event.ts)} · {event.reason}
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
