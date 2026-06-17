interface ProjectNeedsInputParams {
  name: string
  title: string
  projectUrl: string
}

export function projectNeedsInputHtml({ name, title, projectUrl }: ProjectNeedsInputParams): string {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1A1A18">
      <div style="margin-bottom:24px">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;background:#1A1A18;border-radius:6px;color:#F0EEE8;font-weight:600;font-size:14px">F</span>
        <span style="margin-left:8px;font-weight:600;font-size:15px">FormaTexto</span>
      </div>
      <h1 style="font-size:20px;font-weight:600;margin:0 0 8px">Falta uma informação ✍️</h1>
      <p style="font-size:14px;color:#6B6B60;margin:0 0 24px">
        Olá ${name}, quase lá! O processamento de <strong>${title}</strong> foi concluído, mas
        algumas legendas ou fontes de figuras/tabelas estão faltando. Preencha-as para liberar o
        arquivo final.
      </p>
      <a href="${projectUrl}"
         style="display:inline-block;background:#1A3C2E;color:#fff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 20px;border-radius:10px">
        Preencher informações
      </a>
      <p style="font-size:12px;color:#6B6B60;margin:32px 0 0">
        Marcamos no documento os pontos que precisam de atenção. Após preencher (ou remover) cada
        um, o download do arquivo final é liberado.
      </p>
    </div>
  `
}
