import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase'
import { resend } from '../lib/resend'
import { passwordChangedHtml } from '../emails/passwordChanged'

const router = Router()

/** Extracts the user from the Bearer JWT in the Authorization header */
async function getUserFromRequest(req: Request) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

router.post('/notify-password-change', async (req: Request, res: Response) => {
  const user = await getUserFromRequest(req)
  if (!user?.email) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const name = (user.user_metadata?.full_name as string | undefined) ?? user.email

  const { error } = await resend.emails.send({
    from: 'FormaTexto <onboarding@resend.dev>',
    to: user.email,
    subject: 'Your password was changed',
    html: passwordChangedHtml({ name }),
  })

  if (error) {
    console.error('Failed to send password change email:', error)
    res.status(500).json({ error: 'Failed to send email' })
    return
  }

  res.json({ ok: true })
})

export default router
