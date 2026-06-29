'use client'

import * as React from 'react'
import * as RechartsPrimitive from 'recharts'
import { cn } from '@/lib/utils'

const THEMES = { light: '', dark: '.dark' } as const

export type ChartConfig = Record<
  string,
  { label?: React.ReactNode; color?: string; theme?: Record<keyof typeof THEMES, string> }
>

type ChartContextProps = { config: ChartConfig }
const ChartContext = React.createContext<ChartContextProps | null>(null)

function useChart() {
  const ctx = React.useContext(ChartContext)
  if (!ctx) throw new Error('useChart must be inside ChartContainer')
  return ctx
}

// ── ChartContainer ────────────────────────────────────────────────────────────

const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    config: ChartConfig
    children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children']
  }
>(({ id, className, children, config, ...props }, ref) => {
  const uid = React.useId()
  const chartId = `chart-${id ?? uid.replace(/:/g, '')}`

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        ref={ref}
        className={cn(
          'flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/50 [&_.recharts-layer]:outline-none [&_.recharts-surface]:outline-none',
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
})
ChartContainer.displayName = 'ChartContainer'

// ── ChartStyle ────────────────────────────────────────────────────────────────

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const entries = Object.entries(config).filter(([, c]) => c.theme || c.color)
  if (!entries.length) return null
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(([theme, prefix]) =>
            `${prefix} [data-chart=${id}] {\n${entries
              .map(([key, c]) => {
                const color = c.theme?.[theme as keyof typeof THEMES] ?? c.color
                return color ? `  --color-${key}: ${color};` : null
              })
              .filter(Boolean)
              .join('\n')}\n}`,
          )
          .join('\n'),
      }}
    />
  )
}

// ── ChartTooltip ──────────────────────────────────────────────────────────────

const ChartTooltip = RechartsPrimitive.Tooltip

interface TooltipPayloadItem {
  name?: string
  dataKey?: string | number
  value?: number
  color?: string
}

const ChartTooltipContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    active?: boolean
    payload?: TooltipPayloadItem[]
    label?: string
    indicator?: 'dot' | 'line'
  }
>(({ active, payload, label, className, indicator = 'dot' }, ref) => {
  const { config } = useChart()
  if (!active || !payload?.length) return null
  return (
    <div
      ref={ref}
      className={cn(
        'grid min-w-[8rem] gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl',
        className,
      )}
    >
      {label && <p className="font-medium">{label}</p>}
      {payload.map((item, i) => {
        const key = String(item.dataKey ?? item.name ?? '')
        const cfg = config[key]
        const color = item.color ?? cfg?.color
        return (
          <div key={i} className="flex items-center gap-2">
            {indicator === 'dot' ? (
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
            ) : (
              <span className="h-0.5 w-3 shrink-0" style={{ background: color }} />
            )}
            <span className="text-muted-foreground">{cfg?.label ?? item.name}</span>
            <span className="ml-auto font-mono font-medium tabular-nums">
              {item.value?.toLocaleString()}
            </span>
          </div>
        )
      })}
    </div>
  )
})
ChartTooltipContent.displayName = 'ChartTooltipContent'

// ── ChartLegend ───────────────────────────────────────────────────────────────

const ChartLegend = RechartsPrimitive.Legend

const ChartLegendContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    payload?: Array<{ value?: string; color?: string }>
    verticalAlign?: 'top' | 'bottom'
  }
>(({ className, payload, verticalAlign = 'bottom' }, ref) => {
  const { config } = useChart()
  if (!payload?.length) return null
  return (
    <div
      ref={ref}
      className={cn(
        'flex items-center justify-center gap-4',
        verticalAlign === 'top' ? 'pb-3' : 'pt-3',
        className,
      )}
    >
      {payload.map((item, i) => {
        const cfg = config[item.value ?? '']
        return (
          <div key={i} className="flex items-center gap-1.5 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ background: item.color }}
            />
            {cfg?.label ?? item.value}
          </div>
        )
      })}
    </div>
  )
})
ChartLegendContent.displayName = 'ChartLegendContent'

export {
  ChartContainer,
  ChartStyle,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
}
