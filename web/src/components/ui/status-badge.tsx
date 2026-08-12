import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

/**
 * A status pill that spins while the thing it describes is still moving.
 *
 * `active` is passed in rather than inferred from the label: the English states
 * happen to end in "-ing" (Building, Deploying, Merging), but the Lithuanian
 * ones are "Kuriama"/"Diegiama"/"Suliejama", so matching on the text would
 * animate only one language. Callers own the list of in-progress states.
 *
 * The spinner is decorative — the label already says what is happening — so it
 * is hidden from screen readers, and it holds still for anyone who asked the OS
 * to reduce motion.
 */
export function StatusBadge({
  label,
  active = false,
  className,
}: {
  label: string
  active?: boolean
  className?: string
}) {
  return (
    <Badge variant="outline" className={cn('gap-1.5 font-medium', className)}>
      {active && (
        <Loader2
          aria-hidden="true"
          className="h-3 w-3 shrink-0 animate-spin motion-reduce:animate-none"
        />
      )}
      {label}
    </Badge>
  )
}
