import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase'
import { resend } from '../lib/resend'

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
    from: 'FormaTexto <noreply@formatexto.com>',
    to: user.email,
    subject: 'Your password was changed',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1A1A18">
        <div style="margin-bottom:24px">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;background:#1A1A18;border-radius:6px;color:#F0EEE8;font-weight:600;font-size:14px">F</span>
          <span style="margin-left:8px;font-weight:600;font-size:15px">FormaTexto</span>
        </div>
        <h1 style="font-size:20px;font-weight:600;margin:0 0 8px">Password changed</h1>
        <p style="font-size:14px;color:#6B6B60;margin:0 0 24px">
          Hi ${name}, your FormaTexto account password was just updated.
        </p>
        <p style="font-size:14px;color:#6B6B60;margin:0 0 24px">
          If you made this change, no action is needed.
        </p>
        <p style="font-size:14px;color:#6B6B60;margin:0">
          If you did <strong>not</strong> change your password, secure your account immediately by resetting it at
          <a href="https://formatexto.com/forgot-password" style="color:#1A3C2E">formatexto.com/forgot-password</a>.
        </p>
      </div>
    `,
  })

  if (error) {
    console.error('Failed to send password change email:', error)
    res.status(500).json({ error: 'Failed to send email' })
    return
  }

  res.json({ ok: true })
})

export default router
