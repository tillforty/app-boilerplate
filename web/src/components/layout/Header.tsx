import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Settings, LogOut, User, ChevronDown, Menu } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { appConfig, type NavItem } from '@/config/app-config'
import { useAppSettings } from '@/context/AppSettingsContext'
import { useTranslation } from '@/i18n'
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher'

export default function Header() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const { settings } = useAppSettings()
  const { brand, nav, settingsNav } = appConfig
  // Runtime branding from onboarding, falling back to the build-time defaults.
  const appName = settings?.app_name ?? brand.name
  const logoSrc = settings?.logo_url ?? brand.logoSrc
  const [mobileOpen, setMobileOpen] = useState(false)

  // Close the mobile nav whenever the route changes.
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const fullName = user ? `${user.name} ${user.surname}`.trim() : 'User'
  const initials = user
    ? `${user.name.charAt(0)}${user.surname.charAt(0)}`.toUpperCase()
    : 'U'

  function handleSignOut() {
    logout()
    navigate('/login', { replace: true })
  }

  function isActive(href: string) {
    return href === '/' ? location.pathname === '/' : location.pathname.startsWith(href)
  }

  function MobileNavLink({ item }: { item: NavItem }) {
    const Icon = item.icon
    const className = cn(
      'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
      isActive(item.href)
        ? 'bg-primary text-primary-foreground'
        : 'text-gray-700 hover:bg-muted',
    )
    if (item.external) {
      return (
        <a href={item.href} target="_blank" rel="noopener noreferrer" className={className}>
          <Icon className="h-5 w-5 shrink-0" />
          {item.label}
        </a>
      )
    }
    return (
      <Link to={item.href} className={className}>
        <Icon className="h-5 w-5 shrink-0" />
        {item.label}
      </Link>
    )
  }

  return (
    <header className="grid h-14 grid-cols-[auto_1fr_auto] items-center gap-2 border-b bg-white px-3 sm:gap-3 sm:px-4 md:gap-6 md:px-6">
      {/* Left: mobile menu trigger + logo */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={t('nav.navigation')}
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-5 w-5 text-gray-600" />
        </Button>
        <Link to="/" className="flex items-center shrink-0">
          <img src={logoSrc} alt={appName} className="h-5" />
        </Link>
      </div>

      {/* Horizontal nav — centered, driven by app-config. Hidden on mobile. */}
      <nav className="hidden min-w-0 items-center justify-center gap-1 md:flex">
        {nav.map((item) => (
          <Link
            key={item.href}
            to={item.href}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              isActive(item.href)
                ? 'bg-primary text-primary-foreground'
                : 'text-gray-600 hover:bg-primary hover:text-primary-foreground',
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Right side */}
      <div className="flex items-center gap-1 sm:gap-2">
        <LanguageSwitcher />

        {/* Settings icon with dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('nav.settings')}>
              <Settings className="h-5 w-5 text-gray-500" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {settingsNav.map((item) => {
              const Icon = item.icon
              return (
                <DropdownMenuItem
                  key={item.href}
                  onClick={() =>
                    item.external
                      ? window.open(item.href, '_blank', 'noopener,noreferrer')
                      : navigate(item.href)
                  }
                >
                  <Icon className="mr-2 h-4 w-4" />
                  {item.label}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-2 rounded-full" aria-label="User menu">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs font-medium">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <ChevronDown className="hidden h-3 w-3 text-gray-500 sm:block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">{fullName}</p>
                <p className="text-xs text-muted-foreground">{user?.email ?? ''}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/profile')}>
              <User className="mr-2 h-4 w-4" />
              {t('nav.profile')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/settings/users')}>
              <Settings className="mr-2 h-4 w-4" />
              {t('nav.settings')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={handleSignOut}
            >
              <LogOut className="mr-2 h-4 w-4" />
              {t('nav.signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mobile navigation drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="border-b px-4 py-3 text-left">
            <SheetTitle className="flex items-center">
              <img src={logoSrc} alt={appName} className="h-6" />
            </SheetTitle>
          </SheetHeader>
          <nav className="space-y-1 p-3">
            {nav.map((item) => (
              <MobileNavLink key={item.href} item={item} />
            ))}

            <div className="pt-3">
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('nav.settings')}
              </p>
              {settingsNav.map((item) => (
                <MobileNavLink key={item.href} item={item} />
              ))}
            </div>
          </nav>
        </SheetContent>
      </Sheet>
    </header>
  )
}
