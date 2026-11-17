import { LoaderCircle } from 'lucide-react'

export function SessionLoader() {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
    </div>
  )
}
