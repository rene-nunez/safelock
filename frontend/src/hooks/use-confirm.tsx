import { useCallback, useState, type ReactNode } from 'react'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'

type ConfirmOptions = {
  title: string
  description: string
  confirmLabel?: string
  onConfirm: () => void
}

export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)

  const confirm = useCallback((next: ConfirmOptions) => {
    setOptions(next)
  }, [])

  const dialog: ReactNode = (
    <ConfirmDialog
      open={options !== null}
      title={options?.title ?? ''}
      description={options?.description ?? ''}
      confirmLabel={options?.confirmLabel}
      onConfirm={() => {
        options?.onConfirm()
        setOptions(null)
      }}
      onCancel={() => setOptions(null)}
    />
  )

  return { confirm, dialog }
}
