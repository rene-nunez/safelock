import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function ForbiddenPage() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle>Access denied</CardTitle>
          <CardDescription>
            This section is only available to administrators.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Ask an administrator if you believe you should have access.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
