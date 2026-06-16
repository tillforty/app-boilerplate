import { Link, useLocation } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { appConfig, type NavItem } from '@/config/app-config'

interface SidebarProps {
  collapsed: boolean
  onCollapse: (collapsed: boolean) => void
  mobileOpen: boolean
  onMobileClose: () => void
}

function NavLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const location = useLocation()
  const isActive = location.pathname === item.href
  const Icon = item.icon

  const linkContent = (
    <Link
      to={item.href}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        'text-sidebar-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground',
        isActive && 'bg-sidebar-primary text-sidebar-primary-foreground',
        collapsed && 'justify-center px-2',
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      {!collapsed && <span>{item.label}</span>}
    </Link>
  )

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    )
  }

  return linkContent
}

function SidebarContent({ collapsed }: { collapsed?: boolean }) {
  const isCollapsed = collapsed ?? false
  const { user } = useAuth()
  const { brand, nav, settingsNav } = appConfig
  const fullName = user ? `${user.name} ${user.surname}`.trim() : 'User'
  const initials = user
    ? `${user.name.charAt(0)}${user.surname.charAt(0)}`.toUpperCase()
    : 'U'

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div
        className={cn(
          'flex h-14 items-center border-b border-sidebar-border px-4',
          isCollapsed && 'justify-center px-2',
        )}
      >
        <div className="flex items-center gap-2">
          {isCollapsed ? (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-bold text-sm">
              {brand.initial}
            </div>
          ) : (
            <img src={brand.logoSrc} alt={brand.name} className="h-8 w-auto" />
          )}
        </div>
      </div>

      {/* Nav */}
      <ScrollArea className="flex-1 py-4">
        <TooltipProvider delayDuration={0}>
          <nav className="space-y-1 px-2">
            {nav.map((item) => (
              <NavLink key={item.href} item={item} collapsed={isCollapsed} />
            ))}

            {/* Settings group */}
            <div className="pt-4">
              {!isCollapsed && (
                <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                  Settings
                </p>
              )}
              {settingsNav.map((item) => (
                <NavLink key={item.href} item={item} collapsed={isCollapsed} />
              ))}
            </div>
          </nav>
        </TooltipProvider>
      </ScrollArea>

      {/* Bottom: current user */}
      <div className="border-t border-sidebar-border p-2">
        {!isCollapsed && (
          <div className="mt-2 flex items-center gap-3 rounded-lg px-3 py-2">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-sidebar-foreground">{fullName}</p>
              <p className="truncate text-xs text-sidebar-foreground/60">{user?.email ?? ''}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Sidebar({ collapsed, onCollapse, mobileOpen, onMobileClose }: SidebarProps) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'relative hidden md:flex flex-col bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <SidebarContent collapsed={collapsed} />
        {/* Collapse toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onCollapse(!collapsed)}
          className="absolute -right-3 top-[72px] z-10 h-6 w-6 rounded-full border border-border bg-background text-foreground shadow-sm hover:bg-accent"
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronLeft className="h-3 w-3" />
          )}
        </Button>
      </aside>

      {/* Mobile sidebar via Sheet */}
      <Sheet open={mobileOpen} onOpenChange={(open) => !open && onMobileClose()}>
        <SheetContent side="left" className="w-64 bg-sidebar p-0 text-sidebar-foreground">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <TooltipProvider delayDuration={0}>
            <SidebarContent collapsed={false} />
          </TooltipProvider>
        </SheetContent>
      </Sheet>
    </>
  )
}
