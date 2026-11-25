import { formatDateTime } from '@/lib/format'

type EventTimeProps = {
  value: string
  className?: string
}

export function EventTime({ value, className }: EventTimeProps) {
  return (
    <time dateTime={value} title={value} className={className}>
      {formatDateTime(value)}
    </time>
  )
}
