import { Badge, type BadgeProps } from '@mantine/core'
import { type ReactNode } from 'react'

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children)
  }
  return ''
}

interface InitialPillProps extends BadgeProps {
  short?: boolean
}

export function InitialPill({ short, children, ...rest }: InitialPillProps) {
  return (
    <Badge {...rest}>
      {short ? extractText(children).charAt(0).toUpperCase() : children}
    </Badge>
  )
}
