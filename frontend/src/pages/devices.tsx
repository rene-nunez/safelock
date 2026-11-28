import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Plus, X } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import { DeviceCreateForm } from '@/components/devices/device-create-form'
import { DeviceDetailPanel } from '@/components/devices/device-detail-panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Freshness } from '@/components/ui/freshness'
import { InlineNotice } from '@/components/ui/inline-notice'
import { PageToolbar } from '@/components/ui/page-toolbar'
import { ListSkeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'
import {
  ApiError,
  createDevice,
  isBackendUnavailable,
  deleteDevice,
  listDevices,
  synchronizeAccessList,
  unlockDevice,
  updateDevice,
  type CreateDeviceInput,
  type UpdateDeviceInput,
} from '@/lib/api'
import { cn } from '@/lib/utils'

type NoticeArea = 'page' | 'detail' | 'settings'

function errorMessage(error: unknown): string | null {
  if (error === null || error === undefined || isBackendUnavailable(error)) {
    return null
  }
  return error instanceof ApiError
    ? error.message
    : 'Something went wrong. Try again.'
}

export function DevicesPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [success, setSuccess] = useState<{
    message: string
    area: NoticeArea
  } | null>(null)

  function showSuccess(message: string, area: NoticeArea = 'page') {
    setSuccess({ message, area })
  }

  function closeDetail() {
    setSuccess(null)
    resetPanelMutations()
    setSelectedId(null)
    if (requestedDevice) setSearchParams({}, { replace: true })
  }

  const devicesQuery = useQuery({ queryKey: ['devices'], queryFn: listDevices })
  const devices = devicesQuery.data ?? []
  const selected = devices.find((device) => device.id === selectedId) ?? null
  const onlineCount = devices.filter((device) => device.online).length

  const requestedDevice = searchParams.get('device')
  useEffect(() => {
    if (!requestedDevice || !devicesQuery.data) return
    const match = devicesQuery.data.find(
      (device) =>
        device.device_id.toLowerCase() === requestedDevice.toLowerCase(),
    )
    if (!match) return
    // The URL is an entry point: resolve it once the device list loads.
    // oxlint-disable react/set-state-in-effect
    setSelectedId(match.id)
    setSearchParams({}, { replace: true })
    // oxlint-enable react/set-state-in-effect
  }, [devicesQuery.data, requestedDevice, setSearchParams])

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['devices'] })

  const createMutation = useMutation({
    mutationFn: createDevice,
    onMutate: () => setSuccess(null),
    onSuccess: (device) => {
      setCreateOpen(false)
      setSelectedId(device.id)
      showSuccess('Device added.')
      void invalidate()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateDeviceInput }) =>
      updateDevice(id, input),
    onMutate: () => {
      setSuccess(null)
      resetDetailMutations('update')
    },
    onSuccess: (updated, { input }) => {
      if ('locked' in input) {
        showSuccess(
          input.locked ? 'Remote lock enabled.' : 'Remote lock disabled.',
          'detail',
        )
      } else if ('status' in input) {
        showSuccess(
          input.status === 'retired' ? 'Device retired.' : 'Device reactivated.',
          'detail',
        )
      } else if ('requires_pin' in input) {
        showSuccess(
          input.requires_pin
            ? 'PIN requirement enabled.'
            : 'PIN requirement disabled.',
          'detail',
        )
      } else {
        showSuccess('Device settings saved.', 'settings')
      }
      void invalidate()
      return updated
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteDevice,
    onMutate: () => {
      setSuccess(null)
      resetDetailMutations('delete')
    },
    onSuccess: () => {
      setSelectedId(null)
      showSuccess('Device deleted.', 'detail')
      void invalidate()
    },
  })

  const syncMutation = useMutation({
    mutationFn: synchronizeAccessList,
    onMutate: () => {
      setSuccess(null)
      resetDetailMutations('sync')
    },
    onSuccess: (command) => {
      showSuccess(
        `Access list v${command.acl_version} sent to the device.`,
        'detail',
      )
      void invalidate()
    },
  })

  const unlockMutation = useMutation({
    mutationFn: (id: string) => unlockDevice(id),
    onMutate: () => {
      setSuccess(null)
      resetDetailMutations('unlock')
    },
    onSuccess: () => {
      showSuccess('Unlock command sent. Waiting for device response.', 'detail')
      void invalidate()
    },
  })

  function resetDetailMutations(skip?: 'update' | 'delete' | 'sync' | 'unlock') {
    if (skip !== 'update') updateMutation.reset()
    if (skip !== 'delete') deleteMutation.reset()
    if (skip !== 'sync') syncMutation.reset()
    if (skip !== 'unlock') unlockMutation.reset()
  }

  function resetPanelMutations() {
    resetDetailMutations()
    createMutation.reset()
  }

  const mutationError = errorMessage(
    updateMutation.error ??
      deleteMutation.error ??
      syncMutation.error ??
      unlockMutation.error,
  )

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      <PageToolbar>
        {isAdmin ? (
          <Button
            onClick={() => {
              createMutation.reset()
              setCreateOpen((value) => !value)
            }}
            aria-expanded={createOpen}
          >
            {createOpen ? <X className="size-4" /> : <Plus className="size-4" />}
            {createOpen ? 'Close form' : 'Add device'}
          </Button>
        ) : null}
      </PageToolbar>

      <InlineNotice
        tone="success"
        message={success?.area === 'page' ? success.message : null}
      />

      {createOpen && isAdmin ? (
        <DeviceCreateForm
          onCreate={(input: CreateDeviceInput) =>
            createMutation.mutateAsync(input)
          }
          onCancel={() => setCreateOpen(false)}
          isPending={createMutation.isPending}
          error={errorMessage(createMutation.error)}
        />
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] xl:gap-6">
        <Card>
          <CardContent className="flex flex-col px-0">
            <div className="flex flex-col gap-1 px-6 pb-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-2xl font-semibold tabular-nums">
                  {onlineCount}
                </span>
                <span className="text-xs text-muted-foreground">
                  online / {devices.length} total
                </span>
              </div>
              <Freshness updatedAt={devicesQuery.dataUpdatedAt} />
            </div>
            <InlineNotice
              message={errorMessage(devicesQuery.error)}
              className="mx-6 mb-3"
            />
            {devicesQuery.isPending ? (
              <ListSkeleton rows={4} />
            ) : devices.length === 0 ? (
              <p className="flex items-center justify-center px-6 py-10 text-center text-sm text-muted-foreground">
                No devices yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {devices.map((device) => {
                  const active = selectedId === device.id
                  return (
                    <li key={device.id}>
                      <button
                        type="button"
                        aria-current={active ? 'true' : undefined}
                        onClick={() => {
                          setSuccess(null)
                          setSelectedId(device.id)
                        }}
                        className={cn(
                          'flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60',
                          active && 'bg-accent',
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{device.name}</p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge
                            variant={device.online ? 'success' : 'muted'}
                          >
                            {device.online ? 'Online' : 'Offline'}
                          </Badge>
                          <Badge
                            variant={device.locked ? 'danger' : 'outline'}
                          >
                            {device.locked ? 'Locked' : 'Unlocked'}
                          </Badge>
                          {device.requires_pin ? (
                            <Badge className="border-secondary-foreground/20 bg-secondary text-secondary-foreground">
                              PIN
                            </Badge>
                          ) : null}
                          {device.status === 'retired' ? (
                            <Badge variant="muted">Retired</Badge>
                          ) : null}
                        </div>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <DeviceDetailPanel
          device={selected}
          isAdmin={isAdmin}
          pending={{
            update: updateMutation.isPending,
            delete: deleteMutation.isPending,
            sync: syncMutation.isPending,
            unlock: unlockMutation.isPending,
          }}
          error={mutationError}
          successMessage={
            success?.area === 'detail' ? success.message : null
          }
          settingsSuccessMessage={
            success?.area === 'settings' ? success.message : null
          }
          onClose={closeDetail}
          onUpdate={(input: UpdateDeviceInput) =>
            selected && updateMutation.mutate({ id: selected.id, input })
          }
          onSaveSettings={(input: UpdateDeviceInput) =>
            updateMutation.mutateAsync({
              id: selected?.id ?? '',
              input,
            })
          }
          onRevertSettings={() => {
            updateMutation.reset()
            setSuccess(null)
          }}
          onDelete={() => selected && deleteMutation.mutate(selected.id)}
          onSync={() => selected && syncMutation.mutate(selected.id)}
          onUnlock={() => selected && unlockMutation.mutate(selected.id)}
        />
      </div>
    </div>
  )
}
