import { Languages, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslation, LANGUAGE_LABELS } from '@/i18n'

/** Drop into the Header. Lists every registered language; hidden visual noise
 *  until you add a second one, but ready the moment you do. */
export function LanguageSwitcher() {
  const { language, setLanguage, languages, t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('language.label')}>
          <Languages className="h-5 w-5 text-gray-500" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {languages.map((lng) => (
          <DropdownMenuItem key={lng} onClick={() => setLanguage(lng)}>
            <Check
              className={`mr-2 h-4 w-4 ${lng === language ? 'opacity-100' : 'opacity-0'}`}
            />
            {LANGUAGE_LABELS[lng]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
