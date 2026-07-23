import * as React from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'w-full text-sm border border-border rounded-xl px-4 py-3 bg-sand placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-forest-mid/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed resize-none',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = 'Textarea'

export { Textarea }
