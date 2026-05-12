import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-mid/40 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-ink text-sand rounded-xl hover:bg-ink/90',
        cta: 'bg-forest text-white rounded-xl hover:bg-forest-mid',
        outline: 'border border-border bg-white text-ink rounded-xl hover:border-forest-mid/40 hover:bg-sand',
        tertiary: 'text-muted hover:text-ink hover:bg-sand rounded-xl',
        ghost: 'text-muted hover:text-ink rounded-lg',
        link: 'text-ink underline-offset-2 hover:underline',
      },
      size: {
        default: 'text-sm px-4 py-2.5',
        sm: 'text-xs px-3 py-2',
        lg: 'text-sm px-6 py-3',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
