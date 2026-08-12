import { useState } from 'react'
import { useTabParam } from '@/lib/use-tab-param'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { DEMO_ACTIVITY, FAQ } from '@/lib/demo-data'

export default function ComponentsPage() {
  const [agree, setAgree] = useState(true)
  const [demoTab, setDemoTab] = useTabParam<'overview' | 'activity' | 'settings'>(
    ['overview', 'activity', 'settings'],
    'overview',
  )

  return (
    <div className="mx-auto max-w-content space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Components</h1>
        <p className="text-sm text-muted-foreground">
          A gallery of reusable shadcn/ui primitives wired up in this boilerplate.
        </p>
      </div>

      {/* Tabs */}
      <Card>
        <CardHeader>
          <CardTitle>Tabs</CardTitle>
          <CardDescription>Switch between related views.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={demoTab} onValueChange={(v) => setDemoTab(v as typeof demoTab)}>
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="text-sm text-muted-foreground">
              The overview tab. Tabs are great for splitting a busy screen into focused sections
              without a full navigation.
            </TabsContent>
            <TabsContent value="activity">
              <ul className="divide-y text-sm">
                {DEMO_ACTIVITY.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 py-2">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="text-[10px]">
                        {a.who.split(' ').map((p) => p[0]).join('')}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex-1">
                      <span className="font-medium">{a.who}</span>{' '}
                      <span className="text-muted-foreground">{a.action}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{a.when}</span>
                  </li>
                ))}
              </ul>
            </TabsContent>
            <TabsContent value="settings" className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ws">Workspace name</Label>
                <Input id="ws" defaultValue="Tillforty" className="max-w-xs" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={agree} onCheckedChange={(v) => setAgree(Boolean(v))} />
                Email me product updates
              </label>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Buttons + badges */}
        <Card>
          <CardHeader>
            <CardTitle>Buttons &amp; badges</CardTitle>
            <CardDescription>Variants and states.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button>Default</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
            </div>
            <Separator />
            <div className="flex flex-wrap gap-2">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="destructive">Destructive</Badge>
            </div>
            <Separator />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline">Hover for a tooltip</Button>
                </TooltipTrigger>
                <TooltipContent>Tooltips explain an action on hover.</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </CardContent>
        </Card>

        {/* Form inputs */}
        <Card>
          <CardHeader>
            <CardTitle>Form inputs</CardTitle>
            <CardDescription>Labels, inputs, and checkboxes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="full">Full name</Label>
              <Input id="full" placeholder="Ada Lovelace" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mail">Email</Label>
              <Input id="mail" type="email" placeholder="ada@example.com" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox defaultChecked /> Remember this device
            </label>
          </CardContent>
        </Card>
      </div>

      {/* Accordion */}
      <Card>
        <CardHeader>
          <CardTitle>Accordion</CardTitle>
          <CardDescription>Collapsible sections — e.g. an FAQ.</CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {FAQ.map((item, i) => (
              <AccordionItem key={i} value={`item-${i}`}>
                <AccordionTrigger>{item.q}</AccordionTrigger>
                <AccordionContent>{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  )
}
