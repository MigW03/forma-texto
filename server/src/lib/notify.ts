import { supabase } from './supabase'
import { resend } from './resend'
import { projectReadyHtml } from '../emails/projectReady'
import { reuploadNeededHtml } from '../emails/reuploadNeeded'

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

/**
 * Send the "we need your file again" email for a project whose payment succeeded but
 * whose upload never arrived (original_file_path is null). Points the user back to the
 * project page to re-upload — explicitly no re-charge. Throws on failure.
 */
export async function sendReuploadNeededEmail(projectId: string): Promise<void> {
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
  const title = project.title ?? project.original_file_name ?? 'seu documento'

  const { error: emailError } = await resend.emails.send({
    from: 'FormaTexto <onboarding@resend.dev>',
    to: email,
    subject: `Precisamos do seu arquivo novamente — ${title}`,
    html: reuploadNeededHtml({ name, title, projectUrl }),
  })

  if (emailError) {
    throw new Error(`Failed to send reupload-needed email: ${emailError.message ?? emailError}`)
  }
}

