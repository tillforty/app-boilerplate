import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

interface Kpi {
  label: string
  value: string
  hint: string
  trend: 'up' | 'down' | 'neutral'
}

interface Dashboard {
  id: string
  label: string
  kpis: Kpi[]
}

const DASHBOARDS: Dashboard[] = [
  {
    id: 'overview',
    label: 'Overview',
    kpis: [
      { label: 'Active users',     value: '1,248',  hint: '+12% this week',        trend: 'up'      },
      { label: 'Requests today',   value: '38.4k',  hint: 'across all endpoints',  trend: 'up'      },
      { label: 'Storage used',     value: '6.2 GB', hint: 'of 50 GB allocated',    trend: 'neutral' },
      { label: 'Uptime',           value: '99.98%', hint: 'last 30 days',          trend: 'up'      },
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    kpis: [
      { label: 'Monthly revenue',  value: '$84,320', hint: '+8.4% vs last month',  trend: 'up'   },
      { label: 'New customers',    value: '134',     hint: 'this month',            trend: 'up'   },
      { label: 'Churn rate',       value: '1.7%',    hint: '-0.3pp vs last month', trend: 'up'   },
      { label: 'Avg deal size',    value: '$629',    hint: '+$42 vs last month',   trend: 'up'   },
    ],
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    kpis: [
      { label: 'CPU usage',        value: '34%',    hint: 'avg across all nodes',  trend: 'neutral' },
      { label: 'Memory',           value: '61%',    hint: '12.2 GB of 20 GB',      trend: 'up'      },
      { label: 'p95 latency',      value: '142 ms', hint: '+18 ms vs yesterday',   trend: 'down'    },
      { label: 'Error rate',       value: '0.04%',  hint: 'last 24 hours',         trend: 'up'      },
    ],
  },
  {
    id: 'support',
    label: 'Support',
    kpis: [
      { label: 'Open tickets',     value: '27',     hint: '-5 vs yesterday',       trend: 'up'      },
      { label: 'Resolved today',   value: '43',     hint: 'by 6 agents',           trend: 'up'      },
      { label: 'Avg response',     value: '1h 12m', hint: 'first response SLA',    trend: 'neutral' },
      { label: 'CSAT score',       value: '4.7 / 5',hint: 'last 30 days',          trend: 'up'      },
    ],
  },
]

const TREND_ICON = {
  up:      <TrendingUp  className="h-3 w-3 text-emerald-500" />,
  down:    <TrendingDown className="h-3 w-3 text-destructive" />,
  neutral: <Minus       className="h-3 w-3 text-muted-foreground" />,
}

export default function DashboardPage() {
  const { user } = useAuth()
  const [activeDashboard, setActiveDashboard] = useState(DASHBOARDS[0].id)
  const [loading, setLoading] = useState(true)

  // Simulate a network fetch whenever the dashboard changes.
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

        <select
          value={activeDashboard}
          onChange={(e) => setActiveDashboard(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring sm:w-48"
        >
          {DASHBOARDS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
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
    </div>
  )
}
