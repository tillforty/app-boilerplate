import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Settings, LogOut, User, ChevronDown, BookOpen } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import { appConfig } from '@/config/app-config'
import { useTranslation } from '@/i18n'
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher'

export default function Header() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const { brand, nav } = appConfig

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

  return (
    <header className="grid h-14 grid-cols-[auto_1fr_auto] items-center gap-2 border-b bg-white px-3 sm:gap-3 sm:px-4 md:gap-6 md:px-6">
      {/* Logo */}
      <Link to="/" className="flex items-center shrink-0">
        <img src={brand.logoSrc} alt={brand.name} className="h-5" />
      </Link>

      {/* Horizontal nav — centered, driven by app-config */}
      <nav className="flex items-center justify-center gap-1">
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
      <div className="flex items-center gap-2">
        <LanguageSwitcher />

        {/* Settings icon with dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('nav.settings')}>
              <Settings className="h-5 w-5 text-gray-500" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => navigate('/settings/users')}>
              <User className="mr-2 h-4 w-4" />
              {t('nav.users')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => window.open(appConfig.apiDocsUrl, '_blank', 'noopener,noreferrer')}
            >
              <BookOpen className="mr-2 h-4 w-4" />
              {t('nav.apiDocs')}
            </DropdownMenuItem>
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
              <ChevronDown className="h-3 w-3 text-gray-500" />
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
    </header>
  )
}
