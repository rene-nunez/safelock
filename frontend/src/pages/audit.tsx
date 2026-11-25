import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { ApiError, listAuditLogs } from '@/lib/api'
import { formatDateTime } from '@/lib/format'

function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'Something went wrong. Try again.'
}

export function AuditPage() {
  const [limit, setLimit] = useState(50)
  const [offset, setOffset] = useState(0)
  const [action, setAction] = useState('')
  const [draftAction, setDraftAction] = useState('')

  const auditQuery = useQuery({
    queryKey: ['audit-logs', { limit, offset, action }],
    queryFn: () => listAuditLogs({ limit, offset, action }),
  })

  const total = auditQuery.data?.total ?? 0
  const items = auditQuery.data?.items ?? []
  const page = Math.floor(offset / limit) + 1
  const pages = Math.max(1, Math.ceil(total / limit))

  function applyFilter() {
    setOffset(0)
    setAction(draftAction.trim())
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Audit log</CardTitle>
          <CardDescription>
            Administrative actions recorded by the backend.
          </CardDescription>
        </div>
        <Badge variant="outline">{total} entries</Badge>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            applyFilter()
          }}
        >
          <div className="grid w-56 gap-2">
            <Label htmlFor="audit-action">Action</Label>
            <Input
              id="audit-action"
              placeholder="device.create"
              value={draftAction}
              onChange={(event) => setDraftAction(event.target.value)}
            />
          </div>
          <Button type="submit" variant="outline">
            <Search className="size-4" />
            Filter
          </Button>
          {action ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraftAction('')
                setAction('')
                setOffset(0)
              }}
            >
              Clear
            </Button>
          ) : null}
          <div className="ml-auto grid w-28 gap-2">
            <Label htmlFor="audit-limit">Per page</Label>
            <Select
              id="audit-limit"
              value={limit}
              onChange={(event) => {
                setLimit(Number(event.target.value))
                setOffset(0)
              }}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </Select>
          </div>
        </form>

        {auditQuery.isPending ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Loading audit entries…
          </p>
        ) : auditQuery.isError ? (
          <p className="py-12 text-center text-sm text-destructive">
            {errorMessage(auditQuery.error)}
          </p>
        ) : items.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No audit entries match this filter.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-y border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Actor</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Target</th>
                  <th className="px-3 py-2 font-medium">IP</th>
                  <th className="py-2 pl-3 text-right font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-border/60 align-top last:border-0"
                  >
                    <td className="py-3 pr-3 whitespace-nowrap text-muted-foreground">
                      {formatDateTime(entry.ts)}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {entry.actor_id ? `${entry.actor_id.slice(-8)}` : 'CLI'}
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant="secondary">{entry.action}</Badge>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {entry.target}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {entry.ip ?? '—'}
                    </td>
                    <td className="py-3 pl-3 text-right">
                      <details className="inline-block text-left">
                        <summary className="cursor-pointer text-xs text-muted-foreground underline-offset-4 hover:underline">
                          View
                        </summary>
                        <pre className="mt-2 max-w-md overflow-x-auto rounded-md border border-border bg-background/60 p-3 text-[11px] text-muted-foreground">
                          {JSON.stringify(
                            { before: entry.before, after: entry.after },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-sm">
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={offset + limit >= total}
              onClick={() => setOffset(offset + limit)}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
