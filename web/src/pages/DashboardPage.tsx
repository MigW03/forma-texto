import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FileText, Plus, ChevronRight } from 'lucide-react'
import { ROUTES } from '../lib/routes'
import { SESSION_KEY } from './GetStartedPage'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

function clearGetStartedSession() {
  sessionStorage.removeItem(SESSION_KEY)
}

type ServiceType = 'proofreading' | 'formatting'
type StatusType = 'inQueue' | 'processing' | 'ready' | 'delivered'
type GuidelineId = 'abnt' | 'apa' | 'mla' | 'chicago'

type TimeAgo =
  | { kind: 'justNow' }
  | { kind: 'hours'; count: number }
  | { kind: 'days'; count: number }

interface Project {
  id: string
  title: string | null
  fileName: string
  service: ServiceType
  guideline?: GuidelineId
  status: StatusType
  submittedAt: TimeAgo
}

interface DbProject {
  id: string
  title: string | null
  original_file_name: string
  services: ServiceType[]
  guideline: GuidelineId | null
  status: string
  created_at: string
}

const DB_STATUS_MAP: Record<string, StatusType> = {
  pending: 'inQueue',
  processing: 'processing',
  ready: 'ready',
  complete: 'ready',
  delivered: 'delivered',
}

function toTimeAgo(isoDate: string): TimeAgo {
  const diffMs = Date.now() - new Date(isoDate).getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  if (diffHours < 1) return { kind: 'justNow' }
  if (diffHours < 24) return { kind: 'hours', count: diffHours }
  return { kind: 'days', count: Math.floor(diffHours / 24) }
}

function mapDbProject(row: DbProject): Project {
  return {
    id: row.id,
    title: row.title ?? null,
    fileName: row.original_file_name,
    service: row.services[0] ?? 'formatting',
    guideline: row.guideline ?? undefined,
    status: DB_STATUS_MAP[row.status] ?? 'inQueue',
    submittedAt: toTimeAgo(row.created_at),
  }
}

const STATUS_VARIANT: Record<StatusType, 'default' | 'processing' | 'ready' | 'delivered'> = {
  inQueue: 'default',
  processing: 'processing',
  ready: 'ready',
  delivered: 'delivered',
}

export default function DashboardPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    supabase
      .from('projects')
      .select('id, title, original_file_name, services, guideline, status, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('[dashboard] projects fetch error:', error)
        setProjects((data as DbProject[] ?? []).map(mapDbProject))
        setLoading(false)
      })
  }, [user])

  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`dashboard:${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'projects', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const updated = payload.new as DbProject
          setProjects((prev) =>
            prev.map((p) => (p.id === updated.id ? mapDbProject(updated) : p))
          )
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user])

  const activeCount = projects.filter(
    (p) => p.status === 'inQueue' || p.status === 'processing',
  ).length

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{t('dashboard.title')}</h1>
          <p className="text-sm text-muted mt-1">
            {activeCount > 0
              ? t('dashboard.subtitleActive', { count: activeCount })
              : t('dashboard.subtitleNoActive')}
          </p>
        </div>
        <Button asChild variant="default" size="default">
          <Link to={ROUTES.getStarted} onClick={clearGetStartedSession}>
            <Plus size={15} />
            {t('dashboard.newService')}
          </Link>
        </Button>
      </div>

      {/* Project list */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-border px-6 py-5 h-[72px] animate-pulse" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-3">
          {projects.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  )
}

function ProjectRow({ project }: { project: Project }) {
  const { t } = useTranslation()

  return (
    <Link
      to={ROUTES.project.replace(':id', project.id)}
      className="bg-white rounded-2xl border border-border px-6 py-5 flex items-center gap-4 hover:border-forest-mid/40 transition-colors group"
    >
      <div className="shrink-0 w-10 h-10 rounded-xl bg-sand flex items-center justify-center">
        <FileText size={18} className="text-muted" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink truncate">
          {project.title || project.fileName}
        </p>
        {project.title && (
          <p className="text-xs text-muted truncate">{project.fileName}</p>
        )}
        <p className="text-xs text-muted mt-0.5">{formatTime(t, project.submittedAt)}</p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <ServiceBadge service={project.service} guideline={project.guideline} />
        <Badge variant={STATUS_VARIANT[project.status]}>
          {t(`dashboard.status.${project.status}`)}
        </Badge>
        <ChevronRight size={14} className="text-muted/40 group-hover:text-muted transition-colors ml-1" />
      </div>
    </Link>
  )
}

function ServiceBadge({
  service,
  guideline,
}: {
  service: ServiceType
  guideline?: GuidelineId
}) {
  const { t } = useTranslation()
  return (
    <Badge variant="service" className="gap-1">
      {t(`dashboard.service.${service}`)}
      {guideline && (
        <>
          <span className="text-border">·</span>
          <span className="text-muted">
            {t(`services.guidelines.${guideline}.name`)}
          </span>
        </>
      )}
    </Badge>
  )
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <Card className="px-8 py-16 text-center shadow-sm">
      <div className="w-12 h-12 rounded-xl bg-sand flex items-center justify-center mx-auto mb-4">
        <FileText size={22} className="text-muted" />
      </div>
      <h3 className="text-sm font-medium text-ink mb-1">{t('dashboard.emptyTitle')}</h3>
      <p className="text-sm text-muted mb-6">{t('dashboard.emptySubtitle')}</p>
      <Button asChild variant="default" size="lg">
        <Link to={ROUTES.getStarted} onClick={clearGetStartedSession}>
          <Plus size={15} />
          {t('dashboard.newService')}
        </Link>
      </Button>
    </Card>
  )
}

function formatTime(t: (key: string, opts?: Record<string, unknown>) => string, time: TimeAgo): string {
  if (time.kind === 'justNow') return t('dashboard.time.justNow')
  if (time.kind === 'hours') return t('dashboard.time.hoursAgo', { count: time.count })
  return t('dashboard.time.daysAgo', { count: time.count })
}
