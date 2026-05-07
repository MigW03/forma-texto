import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FileText, Plus, ChevronRight } from 'lucide-react'
import { ROUTES } from '../lib/routes'
import { SESSION_KEY } from './GetStartedPage'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'

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

const STATUS_CLASS: Record<StatusType, string> = {
  inQueue: 'bg-[#F0EEE8] text-muted border border-border',
  processing: 'bg-amber-50 text-amber-700 border border-amber-200',
  ready: 'bg-forest/10 text-forest border border-forest/20',
  delivered: 'bg-forest text-white border border-forest',
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
        console.log('[dashboard] user:', user.id, 'rows:', data)
        setProjects((data as DbProject[] ?? []).map(mapDbProject))
        setLoading(false)
      })
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
        <Link
          to={ROUTES.getStarted}
          onClick={clearGetStartedSession}
          className="flex items-center gap-2 bg-ink text-[#F0EEE8] text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-ink/90 transition-colors"
        >
          <Plus size={15} />
          {t('dashboard.newService')}
        </Link>
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
      <div className="shrink-0 w-10 h-10 rounded-xl bg-[#F0EEE8] flex items-center justify-center">
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
        <StatusBadge status={project.status} />
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
    <span className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-[#F0EEE8] text-ink border border-border">
      {t(`dashboard.service.${service}`)}
      {guideline && (
        <>
          <span className="text-border">·</span>
          <span className="text-muted">
            {t(`services.guidelines.${guideline}.name`)}
          </span>
        </>
      )}
    </span>
  )
}

function StatusBadge({ status }: { status: StatusType }) {
  const { t } = useTranslation()
  return (
    <span
      className={`inline-flex items-center text-xs font-medium px-3 py-1.5 rounded-lg ${STATUS_CLASS[status]}`}
    >
      {t(`dashboard.status.${status}`)}
    </span>
  )
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <div className="bg-white rounded-2xl border border-border px-8 py-16 text-center">
      <div className="w-12 h-12 rounded-xl bg-[#F0EEE8] flex items-center justify-center mx-auto mb-4">
        <FileText size={22} className="text-muted" />
      </div>
      <h3 className="text-sm font-medium text-ink mb-1">{t('dashboard.emptyTitle')}</h3>
      <p className="text-sm text-muted mb-6">{t('dashboard.emptySubtitle')}</p>
      <Link
        to={ROUTES.getStarted}
        onClick={clearGetStartedSession}
        className="inline-flex items-center gap-1.5 bg-ink text-[#F0EEE8] text-sm font-medium px-5 py-3 rounded-xl hover:bg-ink/90 transition-colors"
      >
        <Plus size={15} />
        {t('dashboard.newService')}
      </Link>
    </div>
  )
}

function formatTime(t: (key: string, opts?: Record<string, unknown>) => string, time: TimeAgo): string {
  if (time.kind === 'justNow') return t('dashboard.time.justNow')
  if (time.kind === 'hours') return t('dashboard.time.hoursAgo', { count: time.count })
  return t('dashboard.time.daysAgo', { count: time.count })
}
