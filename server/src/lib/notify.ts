import { supabase } from './supabase'
import { resend } from './resend'
import { projectReadyHtml } from '../emails/projectReady'

/**
 * Send the "your document is ready" email for a project.
 * Shared by the n8n callback route (/api/notifications/project-ready) and the
 * server-side formatting orchestrator. Throws on failure so callers can decide.
 */
export async function sendProjectReadyEmail(projectId: string): Promise<void> {
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, title, user_id, original_file_name')
    .eq('id', projectId)
    .single()

  if (projectError || !project) {
    throw new Error(`Project not found: ${projectError?.message ?? projectId}`)
  }

  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(project.user_id)
  if (userError || !userData.user?.email) {
    throw new Error(`User not found for project ${projectId}: ${userError?.message ?? ''}`)
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
    throw new Error(`Failed to send project-ready email: ${emailError.message ?? emailError}`)
  }
}
