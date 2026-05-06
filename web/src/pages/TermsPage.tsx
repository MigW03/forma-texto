import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SupportedLanguage } from '../lib/i18n'
import { ROUTES } from '../lib/routes'

const LAST_UPDATED = 'May 6, 2026'

const content: Record<SupportedLanguage, { sections: { title: string; body: string[] }[] }> = {
  en: {
    sections: [
      {
        title: '1. About FormaTexto',
        body: [
          'FormaTexto ("we", "us", or "the Service") is an academic document processing service that offers proofreading and formatting assistance for academic theses and manuscripts. By submitting a document you agree to these Terms of Service in full.',
        ],
      },
      {
        title: '2. Nature of the Service',
        body: [
          'FormaTexto provides automated and assisted suggestions for grammar, style, and document formatting. Our proofreading service identifies potential errors and proposes corrections; our formatting service restructures your document to match a chosen academic guideline (ABNT, APA, MLA, or Chicago).',
          'All suggestions and changes are advisory in nature. You remain solely responsible for reviewing, accepting, or rejecting any modification before submitting your work to any institution.',
        ],
      },
      {
        title: '3. No Guarantee of Academic Results',
        body: [
          'FormaTexto makes no representation, warranty, or guarantee — express or implied — that use of the Service will result in a passing grade, approval by a thesis committee, or any other specific academic outcome.',
          'Specifically, and without limitation: (a) we do not guarantee that your document will be free of grammatical, stylistic, or typographical errors after processing; (b) we do not guarantee that the formatted document will fully satisfy the specific requirements of your institution, department, or supervising professor; and (c) we accept no liability for low grades, committee rejection, or any academic or professional consequences arising from the submission of a document processed by FormaTexto.',
          'Academic evaluation depends on factors entirely outside our control, including institutional rules, committee preferences, and the quality of the original content. The final responsibility for any submitted work rests solely with the author.',
        ],
      },
      {
        title: '4. Limitation of Liability',
        body: [
          'To the maximum extent permitted by applicable law, FormaTexto and its officers, employees, agents, and licensors shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to: loss of academic standing, loss of scholarship, loss of employment opportunities, or any other loss arising out of or in connection with your use of the Service.',
          'Our total aggregate liability to you for any claims arising under or related to these Terms shall not exceed the amount paid by you to FormaTexto in the twelve (12) months preceding the claim.',
        ],
      },
      {
        title: '5. User Obligations',
        body: [
          'You represent that you are the author of, or have the legal right to submit, any document you upload to FormaTexto. You agree not to submit documents that contain unlawful content or that infringe the intellectual property rights of third parties.',
          'You agree not to use the Service to commit academic fraud, including but not limited to submitting another person\'s work as your own.',
        ],
      },
      {
        title: '6. Intellectual Property',
        body: [
          'You retain all intellectual property rights in your original document. By submitting a document, you grant FormaTexto a limited, non-exclusive licence to process and store your document solely for the purpose of delivering the Service.',
          'FormaTexto does not claim ownership of your content and will not share your documents with third parties except as required to provide the Service or as required by law.',
        ],
      },
      {
        title: '7. Payment and Refunds',
        body: [
          'A one-time free trial is available for the first page of any document, for each account, on either service. No credit card is required for the trial.',
          'Full document processing requires a one-time payment per document as displayed at checkout. All sales are final. Refunds are issued solely at our discretion in cases of documented technical failure attributable to FormaTexto.',
          'You will be charged the full amount upon submission regardless of whether your document requires corrections. The fee covers the processing of your document by our service, not the number or significance of changes made. No refund or reduction will be issued on the basis that the original document was already well-written or required minimal intervention.',
        ],
      },
      {
        title: '8. Data Retention and File Deletion',
        body: [
          'When you submit a document, both the original uploaded file and the processed output file are stored securely in our systems solely for the purpose of making them available to you during the project period.',
          'All files — original and processed — are permanently and automatically deleted thirty (30) days after the project is marked as completed. This deletion is irreversible. You are solely responsible for downloading and saving your processed document before the deletion date.',
          'FormaTexto is not liable for any loss of data resulting from the scheduled deletion of files in accordance with this policy.',
        ],
      },
      {
        title: '9. Changes to These Terms',
        body: [
          'We may update these Terms at any time. Continued use of the Service after changes are posted constitutes acceptance of the updated Terms. We will indicate the date of the most recent revision at the top of this page.',
        ],
      },
      {
        title: '10. Contact',
        body: [
          'If you have questions about these Terms, please contact us at legal@formatexto.com.',
        ],
      },
    ],
  },
  'pt-BR': {
    sections: [
      {
        title: '1. Sobre o FormaTexto',
        body: [
          'O FormaTexto ("nós" ou "o Serviço") é um serviço de processamento de documentos acadêmicos que oferece assistência de revisão gramatical e formatação para teses e manuscritos acadêmicos. Ao enviar um documento, você concorda integralmente com estes Termos de Serviço.',
        ],
      },
      {
        title: '2. Natureza do Serviço',
        body: [
          'O FormaTexto oferece sugestões automatizadas e assistidas de gramática, estilo e formatação de documentos. O serviço de revisão identifica possíveis erros e propõe correções; o serviço de formatação reestrutura o documento conforme a norma acadêmica escolhida (ABNT, APA, MLA ou Chicago).',
          'Todas as sugestões e alterações têm caráter orientativo. Você permanece exclusivamente responsável por revisar, aceitar ou rejeitar qualquer modificação antes de submeter seu trabalho a qualquer instituição.',
        ],
      },
      {
        title: '3. Sem Garantia de Resultados Acadêmicos',
        body: [
          'O FormaTexto não faz nenhuma declaração, garantia ou promessa — expressa ou implícita — de que o uso do Serviço resultará em aprovação, banca favorável ou qualquer outro resultado acadêmico específico.',
          'Especificamente, e sem limitação: (a) não garantimos que o documento estará livre de erros gramaticais, estilísticos ou tipográficos após o processamento; (b) não garantimos que o documento formatado atenderá plenamente aos requisitos específicos de sua instituição, departamento ou orientador; e (c) não aceitamos nenhuma responsabilidade por notas baixas, reprovação pela banca ou quaisquer consequências acadêmicas ou profissionais decorrentes da submissão de um documento processado pelo FormaTexto.',
          'A avaliação acadêmica depende de fatores completamente fora do nosso controle, incluindo normas institucionais, preferências da banca e a qualidade do conteúdo original. A responsabilidade final sobre qualquer trabalho submetido é exclusivamente do autor.',
        ],
      },
      {
        title: '4. Limitação de Responsabilidade',
        body: [
          'Na máxima extensão permitida pela legislação aplicável, o FormaTexto e seus sócios, funcionários, agentes e licenciantes não serão responsáveis por quaisquer danos indiretos, incidentais, especiais, consequenciais ou punitivos, incluindo, sem limitação: perda de status acadêmico, perda de bolsa de estudos, perda de oportunidades de emprego ou qualquer outra perda decorrente ou relacionada ao uso do Serviço.',
          'Nossa responsabilidade total perante você por quaisquer reclamações decorrentes ou relacionadas a estes Termos não excederá o valor pago por você ao FormaTexto nos doze (12) meses anteriores à reclamação.',
        ],
      },
      {
        title: '5. Obrigações do Usuário',
        body: [
          'Você declara ser o autor ou ter o direito legal de submeter qualquer documento enviado ao FormaTexto. Você concorda em não enviar documentos com conteúdo ilegal ou que violem direitos de propriedade intelectual de terceiros.',
          'Você concorda em não utilizar o Serviço para cometer fraude acadêmica, incluindo, sem limitação, submeter trabalho de outra pessoa como sendo seu.',
        ],
      },
      {
        title: '6. Propriedade Intelectual',
        body: [
          'Você mantém todos os direitos de propriedade intelectual sobre o documento original. Ao enviar um documento, você concede ao FormaTexto uma licença limitada e não exclusiva para processar e armazenar o documento exclusivamente para a prestação do Serviço.',
          'O FormaTexto não reivindica propriedade sobre seu conteúdo e não compartilhará seus documentos com terceiros, exceto quando necessário para a prestação do Serviço ou exigido por lei.',
        ],
      },
      {
        title: '7. Pagamento e Reembolsos',
        body: [
          'Uma avaliação gratuita única está disponível para a primeira página de qualquer documento, por conta, em qualquer um dos serviços. Não é necessário cartão de crédito para a avaliação.',
          'O processamento completo do documento requer um pagamento único por documento, conforme exibido no checkout. Todas as vendas são definitivas. Reembolsos são concedidos exclusivamente a nosso critério em casos de falha técnica documentada atribuída ao FormaTexto.',
          'O valor será cobrado integralmente no momento do envio, independentemente de o documento necessitar ou não de correções. A taxa cobre o processamento do documento pelo nosso serviço, não a quantidade ou relevância das alterações realizadas. Nenhum reembolso ou redução será concedido com base no fato de o documento original já estar bem escrito ou ter exigido intervenção mínima.',
        ],
      },
      {
        title: '8. Retenção de Dados e Exclusão de Arquivos',
        body: [
          'Ao enviar um documento, tanto o arquivo original quanto o arquivo processado são armazenados com segurança em nossos sistemas exclusivamente para disponibilizá-los durante o período do projeto.',
          'Todos os arquivos — originais e processados — são excluídos de forma permanente e automática trinta (30) dias após a conclusão do projeto. Essa exclusão é irreversível. Você é o único responsável por baixar e salvar o documento processado antes da data de exclusão.',
          'O FormaTexto não se responsabiliza por qualquer perda de dados decorrente da exclusão programada de arquivos conforme esta política.',
        ],
      },
      {
        title: '9. Alterações nestes Termos',
        body: [
          'Podemos atualizar estes Termos a qualquer momento. O uso continuado do Serviço após a publicação das alterações constitui aceitação dos Termos atualizados. Indicaremos a data da revisão mais recente no topo desta página.',
        ],
      },
      {
        title: '10. Contato',
        body: [
          'Em caso de dúvidas sobre estes Termos, entre em contato pelo e-mail legal@formatexto.com.',
        ],
      },
    ],
  },
  'pt-PT': {
    sections: [
      {
        title: '1. Sobre o FormaTexto',
        body: [
          'O FormaTexto ("nós" ou "o Serviço") é um serviço de processamento de documentos académicos que oferece assistência de revisão gramatical e formatação para teses e manuscritos académicos. Ao enviar um documento, concorda integralmente com estes Termos de Serviço.',
        ],
      },
      {
        title: '2. Natureza do Serviço',
        body: [
          'O FormaTexto oferece sugestões automatizadas e assistidas de gramática, estilo e formatação de documentos. O serviço de revisão identifica possíveis erros e propõe correções; o serviço de formatação reestrutura o documento de acordo com a norma académica escolhida (ABNT, APA, MLA ou Chicago).',
          'Todas as sugestões e alterações têm carácter orientativo. O utilizador permanece exclusivamente responsável por rever, aceitar ou rejeitar qualquer modificação antes de submeter o seu trabalho a qualquer instituição.',
        ],
      },
      {
        title: '3. Sem Garantia de Resultados Académicos',
        body: [
          'O FormaTexto não presta nenhuma declaração, garantia ou promessa — expressa ou implícita — de que a utilização do Serviço resultará em aprovação, júri favorável ou qualquer outro resultado académico específico.',
          'Especificamente, e sem limitação: (a) não garantimos que o documento estará livre de erros gramaticais, estilísticos ou tipográficos após o processamento; (b) não garantimos que o documento formatado satisfará plenamente os requisitos específicos da sua instituição, departamento ou orientador; e (c) não aceitamos qualquer responsabilidade por notas baixas, reprovação pelo júri ou quaisquer consequências académicas ou profissionais decorrentes da submissão de um documento processado pelo FormaTexto.',
          'A avaliação académica depende de fatores completamente fora do nosso controlo, incluindo normas institucionais, preferências do júri e a qualidade do conteúdo original. A responsabilidade final sobre qualquer trabalho submetido é exclusivamente do autor.',
        ],
      },
      {
        title: '4. Limitação de Responsabilidade',
        body: [
          'Na máxima extensão permitida pela legislação aplicável, o FormaTexto e os seus sócios, funcionários, agentes e licenciantes não serão responsáveis por quaisquer danos indiretos, incidentais, especiais, consequenciais ou punitivos, incluindo, sem limitação: perda de estatuto académico, perda de bolsa de estudos, perda de oportunidades de emprego ou qualquer outra perda decorrente ou relacionada com a utilização do Serviço.',
          'A nossa responsabilidade total perante o utilizador por quaisquer reclamações decorrentes ou relacionadas com estes Termos não excederá o montante pago pelo utilizador ao FormaTexto nos doze (12) meses anteriores à reclamação.',
        ],
      },
      {
        title: '5. Obrigações do Utilizador',
        body: [
          'O utilizador declara ser o autor ou ter o direito legal de submeter qualquer documento enviado ao FormaTexto. Concorda em não enviar documentos com conteúdo ilegal ou que violem direitos de propriedade intelectual de terceiros.',
          'Concorda em não utilizar o Serviço para cometer fraude académica, incluindo, sem limitação, submeter trabalho de outra pessoa como sendo seu.',
        ],
      },
      {
        title: '6. Propriedade Intelectual',
        body: [
          'O utilizador mantém todos os direitos de propriedade intelectual sobre o documento original. Ao enviar um documento, concede ao FormaTexto uma licença limitada e não exclusiva para processar e armazenar o documento exclusivamente para a prestação do Serviço.',
          'O FormaTexto não reivindica a propriedade do seu conteúdo e não partilhará os seus documentos com terceiros, exceto quando necessário para a prestação do Serviço ou exigido por lei.',
        ],
      },
      {
        title: '7. Pagamento e Reembolsos',
        body: [
          'Uma avaliação gratuita única está disponível para a primeira página de qualquer documento, por conta, em qualquer um dos serviços. Não é necessário cartão de crédito para a avaliação.',
          'O processamento completo do documento requer um pagamento único por documento, conforme apresentado no checkout. Todas as vendas são definitivas. Os reembolsos são concedidos exclusivamente a nosso critério em casos de falha técnica documentada atribuída ao FormaTexto.',
          'O montante será cobrado integralmente no momento do envio, independentemente de o documento necessitar ou não de correções. A taxa cobre o processamento do documento pelo nosso serviço, não a quantidade ou relevância das alterações efetuadas. Nenhum reembolso ou redução será concedido com base no facto de o documento original já estar bem escrito ou ter exigido intervenção mínima.',
        ],
      },
      {
        title: '8. Retenção de Dados e Eliminação de Ficheiros',
        body: [
          'Ao enviar um documento, tanto o ficheiro original como o ficheiro processado são armazenados de forma segura nos nossos sistemas exclusivamente para os disponibilizar durante o período do projeto.',
          'Todos os ficheiros — originais e processados — são eliminados de forma permanente e automática trinta (30) dias após a conclusão do projeto. Esta eliminação é irreversível. O utilizador é o único responsável por descarregar e guardar o documento processado antes da data de eliminação.',
          'O FormaTexto não se responsabiliza por qualquer perda de dados resultante da eliminação programada de ficheiros nos termos desta política.',
        ],
      },
      {
        title: '9. Alterações a estes Termos',
        body: [
          'Podemos atualizar estes Termos a qualquer momento. A utilização continuada do Serviço após a publicação das alterações constitui aceitação dos Termos atualizados. Indicaremos a data da revisão mais recente no topo desta página.',
        ],
      },
      {
        title: '10. Contacto',
        body: [
          'Em caso de dúvidas sobre estes Termos, contacte-nos através do e-mail legal@formatexto.com.',
        ],
      },
    ],
  },
}

const labels: Record<SupportedLanguage, { title: string; updated: string; back: string }> = {
  en: { title: 'Terms of Service', updated: 'Last updated', back: 'Back' },
  'pt-BR': { title: 'Termos de Serviço', updated: 'Última atualização', back: 'Voltar' },
  'pt-PT': { title: 'Termos de Serviço', updated: 'Última atualização', back: 'Voltar' },
}

export default function TermsPage() {
  const { i18n } = useTranslation()
  const lang = (i18n.language as SupportedLanguage) in content
    ? (i18n.language as SupportedLanguage)
    : 'en'
  const { sections } = content[lang]
  const { title, updated, back } = labels[lang]

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <Link
        to={ROUTES.home}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors mb-8"
      >
        <ArrowLeft size={14} />
        {back}
      </Link>

      <div className="mb-10">
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        <p className="text-xs text-muted mt-2">{updated}: {LAST_UPDATED}</p>
      </div>

      <div className="flex flex-col gap-8">
        {sections.map((section) => (
          <div key={section.title}>
            <h2 className="text-sm font-semibold text-ink mb-3">{section.title}</h2>
            <div className="flex flex-col gap-3">
              {section.body.map((paragraph, i) => (
                <p key={i} className="text-sm text-muted leading-relaxed">
                  {paragraph}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-12 pt-6 border-t border-border">
        <p className="text-xs text-muted">
          © {new Date().getFullYear()} FormaTexto. legal@formatexto.com
        </p>
      </div>
    </div>
  )
}
