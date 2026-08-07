interface ProjectReadyParams {
  name: string
  title: string
  projectUrl: string
}

export function projectReadyHtml({ name, title, projectUrl }: ProjectReadyParams): string {
  return `
    <div style="font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1A1A18">
      <div style="margin-bottom:24px">
        <span style="font-family:'Figtree','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-weight:600;font-size:15px">scriba</span>
      </div>
      <h1 style="font-size:20px;font-weight:600;margin:0 0 8px">Seu arquivo está pronto 🎉</h1>
      <p style="font-size:14px;color:#6B6B60;margin:0 0 24px">
        Olá ${name}, o processamento de <strong>${title}</strong> foi concluído.
      </p>
      <a href="${projectUrl}"
         style="display:inline-block;background:#1A3C2E;color:#fff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 20px;border-radius:10px">
        Baixar arquivo final
      </a>
      <p style="font-size:12px;color:#6B6B60;margin:32px 0 0">
        O arquivo ficará disponível por 30 dias. Após esse prazo será excluído automaticamente.
      </p>
    </div>
  `
}
