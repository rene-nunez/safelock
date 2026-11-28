import { lazy, Suspense, type ComponentProps } from 'react'

const LocationPicker = lazy(async () => {
  const module = await import('@/components/map/location-picker')
  return { default: module.LocationPicker }
})

type LazyLocationPickerProps = ComponentProps<typeof LocationPicker>

export function LazyLocationPicker({
  className,
  ...props
}: LazyLocationPickerProps) {
  return (
    <Suspense
      fallback={
        <div
          className={`w-full animate-pulse rounded-lg border border-border bg-secondary/40 ${className ?? ''}`}
        />
      }
    >
      <LocationPicker {...props} className={className} />
    </Suspense>
  )
}
