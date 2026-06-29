import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis,
} from 'recharts'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '@/components/ui/chart'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Kpi {
  label: string
  value: string
  hint: string
  trend: 'up' | 'down' | 'neutral'
}

interface ChartSeries { name: string; color: string }

interface DashboardChart {
  title: string
  type: 'line' | 'bar' | 'area'
  series: ChartSeries[]
  data: Record<string, string | number>[]
}

interface Dashboard {
  id: string
  label: string
  kpis: Kpi[]
  charts: DashboardChart[]
}

// ── Mock data ─────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul']

const DASHBOARDS: Dashboard[] = [
  {
    id: 'overview',
    label: 'Overview',
    kpis: [
      { label: 'Active users',   value: '1,248',  hint: '+12% this week',       trend: 'up'      },
      { label: 'Requests today', value: '38.4k',  hint: 'across all endpoints', trend: 'up'      },
      { label: 'Storage used',   value: '6.2 GB', hint: 'of 50 GB allocated',   trend: 'neutral' },
      { label: 'Uptime',         value: '99.98%', hint: 'last 30 days',         trend: 'up'      },
    ],
    charts: [
      {
        title: 'Active users over time',
        type: 'area',
        series: [{ name: 'users', color: 'hsl(var(--primary))' }],
        data: MONTHS.map((m, i) => ({ month: m, users: 800 + i * 75 + Math.round(Math.sin(i) * 50) })),
      },
      {
        title: 'Daily requests',
        type: 'bar',
        series: [{ name: 'requests', color: 'hsl(var(--primary))' }],
        data: MONTHS.map((m, i) => ({ month: m, requests: 28000 + i * 1800 + Math.round(Math.cos(i) * 2000) })),
      },
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    kpis: [
      { label: 'Monthly revenue', value: '$84,320', hint: '+8.4% vs last month', trend: 'up' },
      { label: 'New customers',   value: '134',     hint: 'this month',          trend: 'up' },
      { label: 'Churn rate',      value: '1.7%',    hint: '-0.3pp vs last month',trend: 'up' },
      { label: 'Avg deal size',   value: '$629',    hint: '+$42 vs last month',  trend: 'up' },
    ],
    charts: [
      {
        title: 'Revenue vs target',
        type: 'line',
        series: [
          { name: 'revenue', color: 'hsl(var(--primary))' },
          { name: 'target',  color: 'hsl(var(--muted-foreground))' },
        ],
        data: MONTHS.map((m, i) => ({
          month: m,
          revenue: 65000 + i * 3200 + Math.round(Math.sin(i * 1.2) * 4000),
          target:  70000 + i * 2500,
        })),
      },
      {
        title: 'New customers per month',
        type: 'bar',
        series: [{ name: 'customers', color: 'hsl(var(--primary))' }],
        data: MONTHS.map((m, i) => ({ month: m, customers: 80 + i * 8 + Math.round(Math.sin(i) * 10) })),
      },
    ],
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    kpis: [
      { label: 'CPU usage',   value: '34%',    hint: 'avg across all nodes', trend: 'neutral' },
      { label: 'Memory',      value: '61%',    hint: '12.2 GB of 20 GB',     trend: 'up'      },
      { label: 'p95 latency', value: '142 ms', hint: '+18 ms vs yesterday',  trend: 'down'    },
      { label: 'Error rate',  value: '0.04%',  hint: 'last 24 hours',        trend: 'up'      },
    ],
    charts: [
      {
        title: 'CPU & memory usage (%)',
        type: 'line',
        series: [
          { name: 'cpu',    color: 'hsl(var(--primary))' },
          { name: 'memory', color: 'hsl(220 70% 60%)' },
        ],
        data: MONTHS.map((m, i) => ({
          month: m,
          cpu:    28 + Math.round(Math.sin(i * 0.9) * 8 + i * 1.2),
          memory: 52 + Math.round(Math.cos(i * 0.7) * 5 + i * 1.5),
        })),
      },
      {
        title: 'p95 latency (ms)',
        type: 'area',
        series: [{ name: 'latency', color: 'hsl(var(--primary))' }],
        data: MONTHS.map((m, i) => ({ month: m, latency: 110 + i * 5 + Math.round(Math.sin(i * 2) * 15) })),
      },
    ],
  },
  {
    id: 'support',
    label: 'Support',
    kpis: [
      { label: 'Open tickets',   value: '27',      hint: '-5 vs yesterday',    trend: 'up'      },
      { label: 'Resolved today', value: '43',      hint: 'by 6 agents',        trend: 'up'      },
      { label: 'Avg response',   value: '1h 12m',  hint: 'first response SLA', trend: 'neutral' },
      { label: 'CSAT score',     value: '4.7 / 5', hint: 'last 30 days',       trend: 'up'      },
    ],
    charts: [
      {
        title: 'Tickets opened vs resolved',
        type: 'bar',
        series: [
          { name: 'opened',   color: 'hsl(var(--primary))' },
          { name: 'resolved', color: 'hsl(220 70% 60%)' },
        ],
        data: MONTHS.map((m, i) => ({
          month: m,
          opened:   45 + Math.round(Math.sin(i) * 8),
          resolved: 40 + i * 1 + Math.round(Math.cos(i) * 6),
        })),
      },
      {
        title: 'CSAT score trend',
        type: 'line',
        series: [{ name: 'csat', color: 'hsl(var(--primary))' }],
        data: MONTHS.map((m, i) => ({ month: m, csat: +(4.2 + i * 0.07 + Math.sin(i) * 0.1).toFixed(2) })),
      },
    ],
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

const TREND_ICON = {
  up:      <TrendingUp   className="h-3 w-3 text-emerald-500" />,
  down:    <TrendingDown className="h-3 w-3 text-destructive" />,
  neutral: <Minus        className="h-3 w-3 text-muted-foreground" />,
}

function makeConfig(series: ChartSeries[]): ChartConfig {
  return Object.fromEntries(series.map((s) => [s.name, { label: s.name, color: s.color }]))
}

function DashboardChart({ chart }: { chart: DashboardChart }) {
  const config = makeConfig(chart.series)

  const commonProps = {
    data: chart.data,
    margin: { top: 4, right: 4, left: -20, bottom: 0 },
  }

  const axes = (
    <>
      <CartesianGrid vertical={false} strokeDasharray="3 3" />
      <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
      <YAxis tickLine={false} axisLine={false} tickMargin={8} width={48} />
      <ChartTooltip content={<ChartTooltipContent />} />
    </>
  )

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{chart.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="h-48 w-full">
          {chart.type === 'bar' ? (
            <BarChart {...commonProps}>
              {axes}
              {chart.series.map((s) => (
                <Bar key={s.name} dataKey={s.name} fill={`var(--color-${s.name})`} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          ) : chart.type === 'area' ? (
            <AreaChart {...commonProps}>
              {axes}
              {chart.series.map((s) => (
                <Area
                  key={s.name}
                  type="monotone"
                  dataKey={s.name}
                  stroke={`var(--color-${s.name})`}
                  fill={`var(--color-${s.name})`}
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
              ))}
            </AreaChart>
          ) : (
            <LineChart {...commonProps}>
              {axes}
              {chart.series.map((s) => (
                <Line
                  key={s.name}
                  type="monotone"
                  dataKey={s.name}
                  stroke={`var(--color-${s.name})`}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          )}
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth()
  const [activeDashboard, setActiveDashboard] = useState(DASHBOARDS[0].id)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const t = setTimeout(() => setLoading(false), 600)
    return () => clearTimeout(t)
  }, [activeDashboard])

  const dashboard = DASHBOARDS.find((d) => d.id === activeDashboard) ?? DASHBOARDS[0]

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Welcome{user ? `, ${user.name}` : ''}</h1>
          <p className="text-sm text-muted-foreground">
            Here's what's happening across your application.
          </p>
        </div>

        <Select value={activeDashboard} onValueChange={setActiveDashboard}>
          <SelectTrigger className="sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DASHBOARDS.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-2"><Skeleton className="h-4 w-24" /></CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton className="h-7 w-20" />
                  <Skeleton className="h-3 w-28" />
                </CardContent>
              </Card>
            ))
          : dashboard.kpis.map((kpi) => (
              <Card key={kpi.label}>
                <CardHeader className="pb-2">
                  <CardDescription>{kpi.label}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold">{kpi.value}</p>
                  <div className="mt-1 flex items-center gap-1">
                    {TREND_ICON[kpi.trend]}
                    <p className="text-xs text-muted-foreground">{kpi.hint}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        {loading
          ? Array.from({ length: 2 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-2"><Skeleton className="h-4 w-40" /></CardHeader>
                <CardContent><Skeleton className="h-48 w-full" /></CardContent>
              </Card>
            ))
          : dashboard.charts.map((chart) => (
              <DashboardChart key={chart.title} chart={chart} />
            ))}
      </div>
    </div>
  )
}
