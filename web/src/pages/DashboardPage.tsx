import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

interface Stat {
  label: string
  value: string
  hint: string
}

/** Placeholder dashboard metrics. Swap loadStats() for a real API call. */
async function loadStats(): Promise<Stat[]> {
  // Simulate a network fetch so the skeletons are visible on load.
  await new Promise((r) => setTimeout(r, 900))
  return [
    { label: 'Active users', value: '1,248', hint: '+12% this week' },
    { label: 'Requests today', value: '38.4k', hint: 'across all endpoints' },
    { label: 'Storage used', value: '6.2 GB', hint: 'of 50 GB' },
    { label: 'Uptime', value: '99.98%', hint: 'last 30 days' },
  ]
}

export default function DashboardPage() {
  const { user } = useAuth()

  const [stats, setStats] = useState<Stat[] | null>(null)

  useEffect(() => {
    let active = true
    loadStats().then((s) => {
      if (active) setStats(s)
    })
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome{user ? `, ${user.name}` : ''}</h1>
        <p className="text-sm text-muted-foreground">
          You're signed in to the Tillforty app boilerplate.
        </p>
      </div>

      {/* Stat blocks: skeletons while loading, then values. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats === null
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
          : stats.map((s) => (
              <Card key={s.label}>
                <CardHeader className="pb-2">
                  <CardDescription>{s.label}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.hint}</p>
                </CardContent>
              </Card>
            ))}
      </div>
    </div>
  )
}
