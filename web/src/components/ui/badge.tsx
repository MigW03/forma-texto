import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center text-xs font-medium px-3 py-1.5 rounded-lg border',
  {
    variants: {
      variant: {
        default: 'bg-sand text-muted border-border',
        processing: 'bg-amber-50 text-amber-700 border-amber-200',
        complete: 'bg-forest/10 text-forest border-forest/20',
        service: 'bg-sand text-ink border-border',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
