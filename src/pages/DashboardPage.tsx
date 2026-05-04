import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FileText, Plus } from 'lucide-react'
import { ROUTES } from '../lib/routes'

type ServiceType = 'proofreading' | 'formatting'
type StatusType = 'inQueue' | 'processing' | 'ready' | 'delivered'
type GuidelineId = 'abnt' | 'apa' | 'mla' | 'chicago'

type TimeAgo =
  | { kind: 'justNow' }
  | { kind: 'hours'; count: number }
  | { kind: 'days'; count: number }

interface Project {
  id: string
  fileName: string
  service: ServiceType
  guideline?: GuidelineId
  status: StatusType
  submittedAt: TimeAgo
}

const MOCK_PROJECTS: Project[] = [
  {
    id: '1',
    fileName: 'thesis_final_v3.docx',
    service: 'formatting',
    guideline: 'abnt',
    status: 'processing',
    submittedAt: { kind: 'hours', count: 2 },
  },
  {
    id: '2',
    fileName: 'chapter_2_literature_review.docx',
    service: 'proofreading',
    status: 'ready',
    submittedAt: { kind: 'days', count: 1 },
  },
  {
    id: '3',
    fileName: 'introduction_draft.docx',
    service: 'proofreading',
    status: 'delivered',
    submittedAt: { kind: 'days', count: 3 },
  },
  {
    id: '4',
    fileName: 'methodology_section.docx',
    service: 'formatting',
    guideline: 'apa',
    status: 'inQueue',
    submittedAt: { kind: 'justNow' },
  },
]

const STATUS_CLASS: Record<StatusType, string> = {
  inQueue: 'bg-[#F0EEE8] text-muted border border-border',
  processing: 'bg-amber-50 text-amber-700 border border-amber-200',
  ready: 'bg-forest/10 text-forest border border-forest/20',
  delivered: 'bg-forest text-white border border-forest',
}

export default function DashboardPage() {
  const { t } = useTranslation()

  const activeCount = MOCK_PROJECTS.filter(
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
          className="flex items-center gap-2 bg-ink text-[#F0EEE8] text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-ink/90 transition-colors"
        >
          <Plus size={15} />
          {t('dashboard.newService')}
        </Link>
      </div>

      {/* Project list */}
      {MOCK_PROJECTS.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-3">
          {MOCK_PROJECTS.map((project) => (
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
    <div className="bg-white rounded-2xl border border-border px-6 py-5 flex items-center gap-4">
      <div className="shrink-0 w-10 h-10 rounded-xl bg-[#F0EEE8] flex items-center justify-center">
        <FileText size={18} className="text-muted" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink truncate">{project.fileName}</p>
        <p className="text-xs text-muted mt-0.5">{formatTime(t, project.submittedAt)}</p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <ServiceBadge service={project.service} guideline={project.guideline} />
        <StatusBadge status={project.status} />
      </div>
    </div>
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
