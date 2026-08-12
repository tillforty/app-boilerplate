import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /** Marks a label as "still working" (Building, Deploying, Merging, …): adds a
   *  spinner so any in-progress state reads as live without extra markup. */
  loading?: boolean
}

function Badge({ className, variant, loading, children, ...props }: BadgeProps) {
  return (
    <div
      className={cn(badgeVariants({ variant }), loading && "gap-1", className)}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />}
      {children}
    </div>
  )
}

export { Badge, badgeVariants }
