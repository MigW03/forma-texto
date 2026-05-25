import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SupportedLanguage } from '../lib/i18n'
import { ROUTES } from '../lib/routes'

const LAST_UPDATED = 'May 24, 2026'

const content: Record<SupportedLanguage, { sections: { title: string; body: string[] }[] }> = {
  en: {
    sections: [
      {
        title: '1. Who We Are',
        body: [
          'FormaTexto ("we", "us", or "the Service") is an academic document processing service. This Privacy Policy sets out the personal data we collect, the purposes for which we process it, the third parties with whom we share it, and the rights available to you as a data subject.',
          'By using the Service, you acknowledge that you have read and understood this Privacy Policy.',
        ],
      },
      {
        title: '2. Personal Data We Collect',
        body: [
          'We collect your email address and full name when you create an account, either directly or via Google OAuth.',
          'We collect the files you upload to the Service — theses and academic manuscripts in .docx format. These files are processed and stored solely for the purpose of delivering the requested service to you.',
          'Payment transactions are processed exclusively by Stripe. We do not receive, store, or have access to your card number or any sensitive payment credentials. We retain only the Stripe payment intent identifier and the amount charged as part of our transaction records.',
          'We maintain basic operational logs, including project status changes and associated timestamps, for the purpose of service delivery and support. We do not engage in behavioural tracking and we do not sell usage data to third parties.',
        ],
      },
      {
        title: '3. Purposes of Processing',
        body: [
          'We process your personal data for the following purposes: to provide the Service, including processing your document through our artificial intelligence pipeline and making the resulting output available for download; to administer your account and enable access to your projects; to send transactional communications, including order confirmation, project completion notifications, and file deletion warnings; and to fulfil legal obligations applicable to our operations under Brazilian law.',
          'We do not send marketing communications without your prior and explicit consent.',
        ],
      },
      {
        title: '4. Third-Party Service Providers',
        body: [
          'We engage the following third-party service providers in the delivery of the Service. Each provider processes your data only to the extent necessary for their designated function.',
          'Supabase provides database and file storage infrastructure. Your account data and uploaded files are stored on Supabase servers. Supabase holds SOC 2 Type II certification.',
          'Stripe provides payment processing services. All payment card data is handled exclusively by Stripe and does not transit our servers at any point.',
          'n8n provides the document processing pipeline through which your uploaded file passes during the AI formatting and proofreading stages.',
          'Resend or SendGrid provides transactional email delivery.',
          'We do not sell, rent, licence, or otherwise disclose your personal data to any third party for marketing or commercial purposes.',
        ],
      },
      {
        title: '5. File Retention and Deletion',
        body: [
          'Both your original uploaded file and the processed output file are subject to automatic, permanent deletion thirty (30) days following the date on which the relevant project is marked as completed. This deletion schedule is applied without exception and is irreversible.',
          'You bear sole responsibility for downloading and retaining your processed document prior to the applicable deletion date. FormaTexto accepts no liability for loss of data resulting from the scheduled deletion of files in accordance with this policy.',
          'You may request the early deletion of your files at any time by submitting a written request to legal@formatexto.com.',
        ],
      },
      {
        title: '6. Data Security',
        body: [
          'All data transmitted to and from the Service is encrypted in transit using Transport Layer Security (TLS). Files stored in Supabase Storage are protected by row-level security policies that ensure each user may access only their own files.',
          'We implement reasonable technical and organisational measures to protect personal data against unauthorised access, disclosure, alteration, or destruction. However, no security measure provides an absolute guarantee. In the event of a personal data breach that is likely to result in a risk to your rights and freedoms, we will notify you in accordance with applicable law.',
        ],
      },
      {
        title: '7. Your Rights as a Data Subject',
        body: [
          'Subject to applicable law, you have the right to request access to the personal data we hold about you, to request rectification of inaccurate or incomplete data, and to request erasure of your personal data.',
          'To exercise any of these rights, please submit a written request to legal@formatexto.com. We will acknowledge your request within five (5) business days and respond in full within fifteen (15) business days.',
          'You may delete your account at any time through the Service. Account deletion results in the removal of your profile data. Uploaded files are deleted in accordance with the standard thirty-day schedule set out in Section 5, unless you submit a request for immediate deletion.',
        ],
      },
      {
        title: '8. Lei Geral de Proteção de Dados (LGPD)',
        body: [
          'FormaTexto is subject to the Lei Geral de Proteção de Dados Pessoais (LGPD — Federal Law No. 13.709 of 14 August 2018), the Brazilian general personal data protection law.',
          'The legal bases on which we rely to process your personal data are: (a) performance of a contract, for the processing of your document in accordance with your order; (b) legitimate interest, for the maintenance of account security and the sending of transactional communications; and (c) compliance with a legal obligation, for the retention of payment records as required by applicable Brazilian law.',
          'Pursuant to Article 18 of the LGPD, you are entitled to: confirmation of the existence of processing activities; access to your personal data; correction of incomplete, inaccurate, or outdated data; anonymisation, blocking, or erasure of unnecessary or excessive data; portability of your data to another service or product provider; erasure of data processed on the basis of consent; information regarding the public and private entities with which we share your data; and the right to withdraw consent at any time.',
          'To exercise any of the rights conferred by the LGPD, please contact our designated Data Protection Officer at legal@formatexto.com.',
        ],
      },
      {
        title: '9. Amendments to This Policy',
        body: [
          'We reserve the right to amend this Privacy Policy at any time. The date of the most recent revision will be indicated at the top of this page. Your continued use of the Service following the publication of any amendments shall constitute your acceptance of the revised Policy.',
        ],
      },
      {
        title: '10. Contact',
        body: [
          'For enquiries relating to this Privacy Policy or to the processing of your personal data, please contact us at legal@formatexto.com.',
        ],
      },
    ],
  },
  'pt-BR': {
    sections: [
      {
        title: '1. Identificação do Controlador',
        body: [
          'O FormaTexto ("nós", "nos" ou "o Serviço") é um serviço de processamento de documentos acadêmicos. A presente Política de Privacidade descreve as categorias de dados pessoais que coletamos, as finalidades para as quais os tratamos, os terceiros com os quais os compartilhamos e os direitos que assistem ao titular dos dados.',
          'Ao utilizar o Serviço, o usuário declara ter lido e compreendido integralmente esta Política de Privacidade.',
        ],
      },
      {
        title: '2. Dados Pessoais Coletados',
        body: [
          'Coletamos o endereço de e-mail e o nome completo do usuário no momento do cadastro, seja diretamente ou por meio de autenticação via Google OAuth.',
          'Coletamos os arquivos enviados pelo usuário para processamento — teses e manuscritos acadêmicos em formato .docx. Tais arquivos são tratados e armazenados exclusivamente para a execução do serviço solicitado.',
          'As transações de pagamento são processadas exclusivamente pelo Stripe. Não recebemos, armazenamos nem temos acesso ao número do cartão ou a quaisquer credenciais de pagamento sensíveis. Retemos apenas o identificador da intenção de pagamento gerado pelo Stripe e o valor cobrado, para fins de registro contábil.',
          'Mantemos registros operacionais básicos, incluindo alterações de status de projeto e os respectivos timestamps, para fins de prestação do serviço e suporte. Não realizamos rastreamento comportamental e não comercializamos dados de uso com terceiros.',
        ],
      },
      {
        title: '3. Finalidades do Tratamento',
        body: [
          'Tratamos os dados pessoais do usuário para as seguintes finalidades: prestação do Serviço, incluindo o processamento do documento por nosso pipeline de inteligência artificial e a disponibilização do resultado para download; administração da conta do usuário e viabilização do acesso aos seus projetos; envio de comunicações transacionais, incluindo confirmação de pedido, notificação de conclusão do projeto e avisos de exclusão de arquivos; e cumprimento de obrigações legais aplicáveis à nossa operação nos termos da legislação brasileira.',
          'Não enviamos comunicações de caráter publicitário sem o consentimento prévio e expresso do usuário.',
        ],
      },
      {
        title: '4. Operadores e Suboperadores',
        body: [
          'Contratamos os seguintes fornecedores de serviços para viabilizar a operação do Serviço. Cada fornecedor trata os dados pessoais do usuário exclusivamente na medida necessária ao desempenho de sua função.',
          'A Supabase provê infraestrutura de banco de dados e armazenamento de arquivos. Os dados de conta e os arquivos enviados pelo usuário são armazenados nos servidores da Supabase, certificada SOC 2 Tipo II.',
          'O Stripe provê serviços de processamento de pagamentos. Todos os dados de cartão são tratados exclusivamente pelo Stripe e não transitam por nossos servidores em nenhum momento.',
          'O n8n provê o pipeline de processamento de documentos pelo qual o arquivo enviado pelo usuário passa durante as etapas de formatação e revisão com inteligência artificial.',
          'O Resend ou o SendGrid provê serviços de entrega de e-mails transacionais.',
          'O FormaTexto não vende, arrenda, licencia nem divulga os dados pessoais do usuário a terceiros para fins comerciais ou de marketing.',
        ],
      },
      {
        title: '5. Retenção e Exclusão de Arquivos',
        body: [
          'O arquivo original enviado pelo usuário e o arquivo processado resultante estão sujeitos a exclusão automática e permanente trinta (30) dias após a data em que o respectivo projeto for marcado como concluído. Esse prazo é aplicado sem exceção e a exclusão é irreversível.',
          'Incumbe exclusivamente ao usuário efetuar o download e guardar o documento processado antes da data de exclusão aplicável. O FormaTexto não se responsabiliza por perda de dados decorrente da exclusão programada de arquivos nos termos desta política.',
          'O usuário poderá solicitar a exclusão antecipada de seus arquivos a qualquer momento, mediante solicitação escrita dirigida ao endereço legal@formatexto.com.',
        ],
      },
      {
        title: '6. Segurança dos Dados',
        body: [
          'Todos os dados transmitidos de e para o Serviço são criptografados em trânsito por meio do protocolo Transport Layer Security (TLS). Os arquivos armazenados no Supabase Storage são protegidos por políticas de segurança em nível de linha (Row-Level Security) que asseguram que cada usuário acesse exclusivamente seus próprios arquivos.',
          'Adotamos medidas técnicas e organizacionais razoáveis para proteger os dados pessoais contra acesso, divulgação, alteração ou destruição não autorizados. Nenhuma medida de segurança, contudo, oferece garantia absoluta. Na hipótese de incidente de segurança com dados pessoais que possa acarretar risco ao titular, comunicaremos o fato nos prazos e formas exigidos pela legislação aplicável.',
        ],
      },
      {
        title: '7. Direitos do Titular',
        body: [
          'Nos termos da legislação aplicável, o usuário tem o direito de solicitar acesso aos dados pessoais que mantemos sobre si, a retificação de dados inexatos ou incompletos e a exclusão de seus dados pessoais.',
          'Para exercer qualquer desses direitos, o usuário deverá encaminhar solicitação escrita para legal@formatexto.com. Acusaremos o recebimento em até cinco (5) dias úteis e responderemos integralmente em até quinze (15) dias úteis.',
          'O usuário poderá excluir sua conta a qualquer momento por meio do Serviço. A exclusão da conta implica a remoção dos dados de perfil do usuário. Os arquivos são excluídos no prazo padrão de trinta dias previsto na Seção 5, salvo solicitação de exclusão imediata.',
        ],
      },
      {
        title: '8. Lei Geral de Proteção de Dados Pessoais (LGPD)',
        body: [
          'O FormaTexto está sujeito à Lei Geral de Proteção de Dados Pessoais (LGPD — Lei nº 13.709, de 14 de agosto de 2018).',
          'As bases legais nas quais nos fundamos para o tratamento dos dados pessoais do usuário são: (a) execução de contrato, para o processamento do documento conforme o pedido realizado; (b) legítimo interesse, para a manutenção da segurança da conta e o envio de comunicações transacionais; e (c) cumprimento de obrigação legal, para a retenção de registros de pagamento nos termos da legislação aplicável.',
          'Nos termos do artigo 18 da LGPD, são assegurados ao titular dos dados os seguintes direitos: confirmação da existência de tratamento; acesso aos dados; correção de dados incompletos, inexatos ou desatualizados; anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade com a lei; portabilidade dos dados a outro fornecedor de serviço ou produto; eliminação dos dados pessoais tratados com o consentimento do titular; informação sobre as entidades públicas e privadas com as quais compartilhamos os dados; e revogação do consentimento a qualquer tempo.',
          'Para exercer os direitos previstos na LGPD, o titular deverá entrar em contato com nosso Encarregado pelo Tratamento de Dados Pessoais pelo endereço legal@formatexto.com.',
        ],
      },
      {
        title: '9. Alterações à Presente Política',
        body: [
          'Reservamo-nos o direito de alterar a presente Política de Privacidade a qualquer tempo. A data da revisão mais recente será indicada no topo desta página. O uso continuado do Serviço após a publicação de quaisquer alterações constituirá aceitação da Política revisada.',
        ],
      },
      {
        title: '10. Contato',
        body: [
          'Para esclarecimentos relativos à presente Política de Privacidade ou ao tratamento de seus dados pessoais, entre em contato pelo endereço legal@formatexto.com.',
        ],
      },
    ],
  },
  'pt-PT': {
    sections: [
      {
        title: '1. Identificação do Responsável pelo Tratamento',
        body: [
          'O FormaTexto ("nós", "nos" ou "o Serviço") é um serviço de processamento de documentos académicos. A presente Política de Privacidade descreve as categorias de dados pessoais que recolhemos, as finalidades para as quais os tratamos, os terceiros com os quais os partilhamos e os direitos que assistem ao titular dos dados.',
          'Ao utilizar o Serviço, o utilizador declara ter lido e compreendido integralmente a presente Política de Privacidade.',
        ],
      },
      {
        title: '2. Dados Pessoais Recolhidos',
        body: [
          'Recolhemos o endereço de e-mail e o nome completo do utilizador no momento do registo, quer diretamente, quer através de autenticação via Google OAuth.',
          'Recolhemos os ficheiros enviados pelo utilizador para processamento — teses e manuscritos académicos em formato .docx. Tais ficheiros são tratados e armazenados exclusivamente para a execução do serviço solicitado.',
          'As transações de pagamento são processadas exclusivamente pelo Stripe. Não recebemos, armazenamos nem temos acesso ao número do cartão ou a quaisquer credenciais de pagamento sensíveis. Retemos apenas o identificador da intenção de pagamento gerado pelo Stripe e o montante cobrado, para fins de registo contabilístico.',
          'Mantemos registos operacionais básicos, incluindo alterações de estado de projeto e as respetivas marcas temporais, para fins de prestação do serviço e suporte. Não realizamos rastreamento comportamental e não comercializamos dados de utilização com terceiros.',
        ],
      },
      {
        title: '3. Finalidades do Tratamento',
        body: [
          'Tratamos os dados pessoais do utilizador para as seguintes finalidades: prestação do Serviço, incluindo o processamento do documento pelo nosso pipeline de inteligência artificial e a disponibilização do resultado para download; administração da conta do utilizador e viabilização do acesso aos seus projetos; envio de comunicações transacionais, incluindo confirmação de encomenda, notificação de conclusão do projeto e avisos de eliminação de ficheiros; e cumprimento de obrigações legais aplicáveis à nossa operação.',
          'Não enviamos comunicações de caráter publicitário sem o consentimento prévio e expresso do utilizador.',
        ],
      },
      {
        title: '4. Subcontratantes e Terceiros',
        body: [
          'Contratamos os seguintes prestadores de serviços para viabilizar a operação do Serviço. Cada prestador trata os dados pessoais do utilizador exclusivamente na medida necessária ao desempenho da sua função.',
          'A Supabase fornece infraestrutura de base de dados e armazenamento de ficheiros. Os dados de conta e os ficheiros enviados pelo utilizador são armazenados nos servidores da Supabase, certificada SOC 2 Tipo II.',
          'O Stripe fornece serviços de processamento de pagamentos. Todos os dados de cartão são tratados exclusivamente pelo Stripe e não transitam pelos nossos servidores em momento algum.',
          'O n8n fornece o pipeline de processamento de documentos pelo qual o ficheiro enviado pelo utilizador passa durante as etapas de formatação e revisão com inteligência artificial.',
          'O Resend ou o SendGrid fornece serviços de entrega de e-mails transacionais.',
          'O FormaTexto não vende, arrenda, licencia nem divulga os dados pessoais do utilizador a terceiros para fins comerciais ou de marketing.',
        ],
      },
      {
        title: '5. Retenção e Eliminação de Ficheiros',
        body: [
          'O ficheiro original enviado pelo utilizador e o ficheiro processado resultante estão sujeitos a eliminação automática e permanente trinta (30) dias após a data em que o respetivo projeto seja marcado como concluído. Este prazo é aplicado sem exceção e a eliminação é irreversível.',
          'Incumbe exclusivamente ao utilizador efetuar o download e guardar o documento processado antes da data de eliminação aplicável. O FormaTexto não se responsabiliza pela perda de dados resultante da eliminação programada de ficheiros nos termos da presente política.',
          'O utilizador poderá solicitar a eliminação antecipada dos seus ficheiros a qualquer momento, mediante pedido escrito dirigido ao endereço legal@formatexto.com.',
        ],
      },
      {
        title: '6. Segurança dos Dados',
        body: [
          'Todos os dados transmitidos de e para o Serviço são encriptados em trânsito através do protocolo Transport Layer Security (TLS). Os ficheiros armazenados no Supabase Storage são protegidos por políticas de segurança ao nível de linha (Row-Level Security) que asseguram que cada utilizador acede exclusivamente aos seus próprios ficheiros.',
          'Adotamos medidas técnicas e organizativas razoáveis para proteger os dados pessoais contra acesso, divulgação, alteração ou destruição não autorizados. Nenhuma medida de segurança oferece, todavia, garantia absoluta. Na hipótese de incidente de segurança com dados pessoais suscetível de implicar risco para o titular, comunicaremos o facto nos prazos e formas exigidos pela legislação aplicável.',
        ],
      },
      {
        title: '7. Direitos do Titular dos Dados',
        body: [
          'Nos termos da legislação aplicável, o utilizador tem o direito de solicitar o acesso aos dados pessoais que mantemos sobre si, a retificação de dados inexatos ou incompletos e a eliminação dos seus dados pessoais.',
          'Para exercer qualquer destes direitos, o utilizador deverá enviar um pedido escrito para legal@formatexto.com. Acusaremos a receção no prazo de cinco (5) dias úteis e responderemos integralmente no prazo de quinze (15) dias úteis.',
          'O utilizador poderá eliminar a sua conta a qualquer momento através do Serviço. A eliminação da conta implica a remoção dos dados de perfil do utilizador. Os ficheiros são eliminados no prazo padrão de trinta dias previsto na Secção 5, salvo pedido de eliminação imediata.',
        ],
      },
      {
        title: '8. Lei Geral de Proteção de Dados Pessoais (LGPD)',
        body: [
          'O FormaTexto está sujeito à Lei Geral de Proteção de Dados Pessoais (LGPD — Lei n.º 13.709, de 14 de agosto de 2018), lei brasileira de proteção de dados pessoais.',
          'As bases legais em que nos fundamos para o tratamento dos dados pessoais do utilizador são: (a) execução de contrato, para o processamento do documento conforme o pedido efetuado; (b) interesse legítimo, para a manutenção da segurança da conta e o envio de comunicações transacionais; e (c) cumprimento de obrigação legal, para a retenção de registos de pagamento nos termos da legislação aplicável.',
          'Nos termos do artigo 18.º da LGPD, são assegurados ao titular dos dados os seguintes direitos: confirmação da existência de tratamento; acesso aos dados; correção de dados incompletos, inexatos ou desatualizados; anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade com a lei; portabilidade dos dados a outro prestador de serviço ou produto; eliminação dos dados pessoais tratados com base no consentimento do titular; informação sobre as entidades públicas e privadas com as quais partilhamos os dados; e revogação do consentimento a qualquer momento.',
          'Para exercer os direitos previstos na LGPD, o titular deverá contactar o nosso Encarregado de Proteção de Dados através do endereço legal@formatexto.com.',
        ],
      },
      {
        title: '9. Alterações à Presente Política',
        body: [
          'Reservamo-nos o direito de alterar a presente Política de Privacidade a qualquer momento. A data da revisão mais recente será indicada no topo desta página. A utilização continuada do Serviço após a publicação de quaisquer alterações constituirá aceitação da Política revista.',
        ],
      },
      {
        title: '10. Contacto',
        body: [
          'Para esclarecimentos relativos à presente Política de Privacidade ou ao tratamento dos seus dados pessoais, contacte-nos através do endereço legal@formatexto.com.',
        ],
      },
    ],
  },
}

const labels: Record<SupportedLanguage, { title: string; updated: string; back: string }> = {
  en: { title: 'Privacy Policy', updated: 'Last updated', back: 'Back' },
  'pt-BR': { title: 'Política de Privacidade', updated: 'Última atualização', back: 'Voltar' },
  'pt-PT': { title: 'Política de Privacidade', updated: 'Última atualização', back: 'Voltar' },
}

export default function PrivacyPage() {
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
