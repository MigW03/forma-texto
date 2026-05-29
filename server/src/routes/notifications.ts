import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase'
import { resend } from '../lib/resend'
import { projectReadyHtml } from '../emails/projectReady'

const router = Router()

/** Shared secret n8n sends in x-webhook-secret header */
function isAuthorized(req: Request): boolean {
  const secret = process.env.WEBHOOK_SECRET
  if (!secret) return false
  return req.headers['x-webhook-secret'] === secret
}

router.post('/project-ready', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { projectId } = req.body as { projectId?: string }
  if (!projectId) {
    res.status(400).json({ error: 'projectId required' })
    return
  }

  // Fetch project
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, title, user_id, original_file_name, services, guideline')
    .eq('id', projectId)
    .single()

  if (projectError || !project) {
    console.error('Project not found:', projectError)
    res.status(404).json({ error: 'Project not found' })
    return
  }

  // Fetch user email via admin API
  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(project.user_id)

  if (userError || !userData.user?.email) {
    console.error('User not found:', userError)
    res.status(404).json({ error: 'User not found' })
    return
  }

  const email = userData.user.email
  const name = (userData.user.user_metadata?.full_name as string | undefined) ?? email
  const projectUrl = `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/projects/${project.id}`
  const title = project.title ?? project.original_file_name ?? 'Your document'

  const { error: emailError } = await resend.emails.send({
    from: 'FormaTexto <onboarding@resend.dev>',
    to: email,
    subject: `${title} está pronto`,
    html: projectReadyHtml({ name, title, projectUrl }),
  })

  if (emailError) {
    console.error('Failed to send project-ready email:', emailError)
    res.status(500).json({ error: 'Failed to send email' })
    return
  }

  res.json({ ok: true })
})

export default router
