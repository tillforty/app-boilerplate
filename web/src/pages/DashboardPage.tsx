import { useAuth } from '@/context/AuthContext'
import { usePermissions } from '@/context/PermissionsContext'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function DashboardPage() {
  const { user } = useAuth()
  const { role } = usePermissions()

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Welcome{user ? `, ${user.name}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">
          You're signed in to the Tillforty app boilerplate.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Your signed-in identity.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-medium">{user ? `${user.name} ${user.surname}` : '—'}</p>
            <p className="text-muted-foreground">{user?.email ?? '—'}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Role</CardTitle>
            <CardDescription>Your effective access level.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="font-medium capitalize">{role ?? '—'}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Getting started</CardTitle>
            <CardDescription>Build your app on top of the shell.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Edit <code className="text-foreground">src/config/app-config.tsx</code> for branding
            and navigation, then add your own pages and routes.
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
