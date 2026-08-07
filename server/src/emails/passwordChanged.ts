interface PasswordChangedParams {
  name: string
}

export function passwordChangedHtml({ name }: PasswordChangedParams): string {
  return `
    <div style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1A1A18">
      <div style="margin-bottom:24px">
        <span style="font-family:'Figtree','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-weight:600;font-size:15px">scriba</span>
      </div>
      <h1 style="font-size:20px;font-weight:600;margin:0 0 8px">Password changed</h1>
      <p style="font-size:14px;color:#6B6B60;margin:0 0 24px">
        Hi ${name}, your scriba account password was just updated.
      </p>
      <p style="font-size:14px;color:#6B6B60;margin:0 0 24px">
        If you made this change, no action is needed.
      </p>
      <p style="font-size:14px;color:#6B6B60;margin:0">
        If you did <strong>not</strong> change your password, secure your account immediately by resetting it at
        <a href="https://scriba.com/forgot-password" style="color:#1A3C2E">scriba.com/forgot-password</a>.
      </p>
    </div>
  `
}
