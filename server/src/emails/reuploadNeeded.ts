interface ReuploadNeededParams {
  name: string
  title: string
  projectUrl: string
}

export function reuploadNeededHtml({ name, title, projectUrl }: ReuploadNeededParams): string {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1A1A18">
      <div style="margin-bottom:24px">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;background:#1A1A18;border-radius:6px;color:#F0EEE8;font-weight:600;font-size:14px">F</span>
        <span style="margin-left:8px;font-weight:600;font-size:15px">FormaTexto</span>
      </div>
      <h1 style="font-size:20px;font-weight:600;margin:0 0 8px">Precisamos do seu arquivo novamente</h1>
      <p style="font-size:14px;color:#6B6B60;margin:0 0 16px">
        Olá ${name}, recebemos o seu pagamento de <strong>${title}</strong>, mas o arquivo não chegou
        até nós — provavelmente a página foi recarregada antes do envio terminar.
      </p>
      <p style="font-size:14px;color:#6B6B60;margin:0 0 24px">
        <strong>Não se preocupe: você não será cobrado novamente.</strong> Basta reenviar o mesmo
        documento na página do projeto e o processamento começa automaticamente.
      </p>
      <a href="${projectUrl}"
         style="display:inline-block;background:#1A3C2E;color:#fff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 20px;border-radius:10px">
        Reenviar arquivo
      </a>
      <p style="font-size:12px;color:#6B6B60;margin:32px 0 0">
        Se você não reconhece esta compra, ignore este e-mail.
      </p>
    </div>
  `
}
