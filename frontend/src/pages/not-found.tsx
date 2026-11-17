import { Link } from 'react-router-dom'

import { buttonVariants } from '@/components/ui/button-variants'
import { cn } from '@/lib/utils'

export function NotFoundPage() {
  return (
    <div className="grid min-h-[60vh] place-items-center text-center">
      <div>
        <p className="text-sm text-muted-foreground">404</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">
          Page not found
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you are looking for does not exist.
        </p>
        <Link to="/" className={cn(buttonVariants({ size: 'sm' }), 'mt-5')}>
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
