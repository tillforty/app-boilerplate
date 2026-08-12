import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TableCell, TableRow } from '@/components/ui/table'

type Variant = 'default' | 'search' | 'error'

const iconStyles: Record<Variant, string> = {
  default: 'bg-primary/10 text-primary ring-primary/5',
  search: 'bg-muted text-muted-foreground ring-muted-foreground/10',
  error: 'bg-destructive/10 text-destructive ring-destructive/5',
}

export interface TableEmptyStateProps {
  /** Number of columns to span — should match the table's column count. */
  colSpan: number
  /** A lucide icon component, e.g. `Users`. Defaults to an inbox. */
  icon?: LucideIcon
  title: string
  description?: string
  /** Optional call-to-action(s), e.g. a "Add record" button. */
  action?: React.ReactNode
  variant?: Variant
  className?: string
}

/**
 * A centered, illustrated empty state rendered as a full-width table row.
 * Drops into a `<TableBody>` in place of the usual "no rows" cell, keeping the
 * table's column layout intact. Use `variant="search"` for filtered-no-match
 * and `variant="error"` for load failures.
 */
export function TableEmptyState({
  colSpan,
  icon: Icon = Inbox,
  title,
  description,
  action,
  variant = 'default',
  className,
}: TableEmptyStateProps) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className={cn('p-0', className)}>
        <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-14 text-center">
          <div
            className={cn(
              'mb-3 grid size-14 place-items-center rounded-2xl ring-[6px]',
              iconStyles[variant],
            )}
          >
            <Icon className="size-6" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <h3 className="text-[15px] font-semibold tracking-tight text-foreground text-balance">
            {title}
          </h3>
          {description && (
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground text-pretty">
              {description}
            </p>
          )}
          {action && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">{action}</div>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}
