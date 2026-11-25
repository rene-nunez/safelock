import { cn } from '@/lib/utils'

type SafelockLogoProps = {
  className?: string
}

export function SafelockLogo({ className }: SafelockLogoProps) {
  return (
    <span
      className={cn(
        'font-logo font-extrabold tracking-[0.02em] text-brand',
        className,
      )}
    >
      Safelock
    </span>
  )
}
