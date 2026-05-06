import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from '../locales/en.json'
import ptBR from '../locales/pt-BR.json'
import ptPT from '../locales/pt-PT.json'

export const SUPPORTED_LANGUAGES = ['en', 'pt-BR', 'pt-PT'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      'pt-BR': { translation: ptBR },
      'pt-PT': { translation: ptPT },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES,
    load: 'currentOnly',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'formatexto.lang',
      convertDetectedLanguage: (lng: string) => {
        if (lng === 'pt-BR' || lng === 'pt-PT') return lng
        if (lng.toLowerCase().startsWith('pt')) return 'pt-BR'
        return 'en'
      },
    },
  })

export default i18n
