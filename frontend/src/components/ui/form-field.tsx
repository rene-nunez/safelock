import { cloneElement, isValidElement, type ReactNode } from 'react'

import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type FormFieldProps = {
  label: string
  htmlFor: string
  hint?: string
  error?: string
  className?: string
  reserveMessage?: boolean
  children: ReactNode
}

export function FormField({
  label,
  htmlFor,
  hint,
  error,
  className,
  reserveMessage = true,
  children,
}: FormFieldProps) {
  const hintId = `${htmlFor}-hint`
  const errorId = `${htmlFor}-error`
  // Errors replace hints so the field keeps the same height when validation runs.
  const describedBy = error ? errorId : hint ? hintId : undefined

  const control = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, {
        id: htmlFor,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
      })
    : children

  return (
    <div className={cn('grid gap-2', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {control}
      {error || hint || reserveMessage ? (
        <div className="min-h-4 text-xs">
          {error ? (
            <p id={errorId} className="text-red-400">
              {error}
            </p>
          ) : hint ? (
            <p id={hintId} className="text-muted-foreground">
              {hint}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
