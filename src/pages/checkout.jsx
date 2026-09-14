// Fluxo de checkout: aceite Voomp, matrícula Asaas, confirmação de pagamento, lista de
// espera e páginas de retorno dos checkouts externos. Extraído de src/main.jsx (organização
// de arquivos pedida pela Erica, 05/09/2026).
import { useEffect, useMemo, useRef, useState } from 'react';
import { track, getAttribution, identifyForMeta } from '../lib/analytics.js';
import { newMetaEventId } from '../lib/meta-events.js';
import { postJson } from '../lib/api.js';
import { money } from '../lib/format.js';
import { courses, useCatalog } from '../lib/catalog-context.js';
import {
  cartSummary, voompPaymentSplit, eligibleAdditionalCourses, previewCheckoutCoupon, displayPrice,
  displayPriceNumber, selectedOffer, whatsappLink, findPublicCourse,
} from '../lib/catalog-helpers.js';
import { ContractSummary, SafeImage } from '../components/shared.jsx';
import { CLASS_TABLES, CONTRACT_VERSION, contractText } from '../lib/contracts.js';

export function AcceptancePage({ course }) {
  const params = new URLSearchParams(window.location.search);
  const initialDate = params.get('turma') || course.dates[0];
  const [form, setForm] = useState({ name: '', whatsapp: '', email: '', cpf: '', rg: '', address: '', turma: initialDate, terms: false, payment: false, rules: false, contact: false, whatsappOptIn: true, contractAccepted: false, signedName: '' });
  // Contrato do Cabeleireiro (pedido da Erica, 09/09/2026): a aluna lê o contrato inteiro, já
  // preenchido com os dados que ela digitou, e assina antes de qualquer link de pagamento
  // aparecer. Só as turmas do Cabeleireiro têm contrato — curso sem contrato segue como antes.
  const [contratoAberto, setContratoAberto] = useState(false);
  const exigeContrato = Boolean(CLASS_TABLES[form.turma]);
  const [submitted, setSubmitted] = useState(false);
  const [apiState, setApiState] = useState({ loading: false, error: '', result: null });
  useEffect(() => track('begin_voomp_acceptance', { course_slug: course.slug, class_date: initialDate }), [course.slug]);
  function update(key, value) { setForm((prev) => ({ ...prev, [key]: value })); }
  async function submit(event) {
    event.preventDefault();
    setApiState({ loading: true, error: '', result: null });
    // Um id só pro Pixel e pra API de Conversões deste envio. Gerado ANTES de mandar, porque o
    // servidor precisa receber o mesmo id — é assim que a Meta entende que o evento que ela
    // recebeu do navegador e o que recebeu do servidor são a MESMA matrícula, e conta uma.
    const metaEventId = newMetaEventId('submit_voomp_acceptance', getAttribution().session_id);
    const payload = {
      name: form.name,
      whatsapp: form.whatsapp,
      email: form.email,
      cpf: form.cpf,
      metaEventId,
      courseSlug: course.slug,
      courseName: course.name,
      classDate: form.turma,
      termsRead: form.terms,
      paymentAware: form.payment,
      enrollmentAware: form.rules,
      wantsContactBeforePayment: form.contact,
      whatsappOptIn: form.whatsappOptIn,
      rg: form.rg,
      address: form.address,
      signedName: form.signedName,
      contractAccepted: form.contractAccepted,
      cart: cartSummary(course, form.turma),
      attribution: getAttribution(),
    };
    try {
      const result = await postJson('/api/acceptance', payload);
      // Identifica a aluna pro Pixel ANTES do evento: assim o Lead sai com e-mail, nome e
      // telefone, em vez de depender do Pixel adivinhar (35% de acerto, medido pela Meta).
      identifyForMeta({ name: form.name, email: form.email, whatsapp: form.whatsapp });
      track('submit_voomp_acceptance', { meta_event_id: metaEventId, course_slug: course.slug, class_date: form.turma, wants_contact: form.contact, api_status: result.status, next_action: result.nextAction, value: cartSummary(course, form.turma)?.priceNumber });
      setApiState({ loading: false, error: '', result });
      setSubmitted(true);
      if (result?.checkout?.url && !form.contact) {
        window.setTimeout(() => { window.location.href = result.checkout.url; }, 900);
      }
    } catch (error) {
      const messages = {
        enrollment_closed: 'A matrícula dessa turma já fechou. Escolha outra data ou fale com o atendimento.',
        class_full: 'Essa turma acabou de lotar. Escolha outra data ou fale com o atendimento.',
        contract_not_accepted: 'Marque que leu e aceita o contrato para continuar.',
        signature_required: 'Assine digitando seu nome completo, igual ao do cadastro.',
        signature_name_mismatch: 'A assinatura precisa ser o mesmo nome completo do cadastro acima.',
        rg_required: 'O contrato precisa do seu RG.',
        address_required: 'O contrato precisa do seu endereço completo.',
        contract_not_available: 'Não encontrei o contrato desta turma. Fale com o atendimento antes de pagar.',
      };
      setApiState({ loading: false, error: messages[error.message] || 'Não foi possível registrar o aceite agora. Tente novamente ou fale com o atendimento.', result: null });
      track('submit_voomp_acceptance_error', { course_slug: course.slug, class_date: form.turma, error: error.message });
    }
  }
  const payMessage = `Oi! Concluí o aceite digital no site da escola para ${course.name}, turma ${form.turma}. Quero receber o link oficial de pagamento da matrícula e as próximas orientações.`;
  const helpMessage = `Oi! Estou preenchendo a pré-matrícula do curso ${course.name}, turma ${form.turma}, mas quero falar com alguém antes do pagamento.`;
  const voompSplit = voompPaymentSplit(course, form.turma);
  const summaryMatricula = voompSplit.enrollmentFee ? money(Math.round(voompSplit.enrollmentFee * 100)) : 'valor informado no checkout';
  const summaryTotal = voompSplit.priceNumber ? money(Math.round(voompSplit.priceNumber * 100)) : null;
  if (submitted) {
    const checkoutUrl = apiState.result?.checkout?.url;
    return <section className="section confirmPage"><div className="confirmCard"><p className="eyebrow">Aceite registrado</p><h1>{checkoutUrl && !form.contact ? 'Abrindo checkout da matrícula' : 'Próximo passo: atendimento da matrícula'}</h1><p>{form.name}, seu aceite foi registrado para <strong>{course.name}</strong>, turma <strong>{form.turma}</strong>.</p>{checkoutUrl && !form.contact ? <p>Vou te direcionar para o checkout oficial da matrícula. Se não abrir automaticamente, toque no botão abaixo.</p> : <p>O atendimento da escola recebe seus dados e consegue seguir com o link/retorno pelo WhatsApp.</p>}<div className="confirmActions">{checkoutUrl && !form.contact ? <a className="button button--primary" href={checkoutUrl}>Abrir checkout Voomp</a> : <a className="button button--primary" href={`https://wa.me/{WHATSAPP}?text=${encodeURIComponent(payMessage)}`}>Receber link de pagamento</a>}<a className="button button--outline" href={`https://wa.me/{WHATSAPP}?text=${encodeURIComponent(helpMessage)}`}>Falar com alguém antes</a></div></div></section>;
  }
  return <section className="section checkoutPage"><div className="checkoutIntro"><p className="eyebrow">Pré-matrícula assistida</p><h1>Leia as condições de matrícula para continuar</h1><p>Antes de receber o link de pagamento da matrícula, leia as condições principais do curso e confirme seu aceite.</p></div><ContractSummary course={course} selectedDate={form.turma} /><div className="checkoutGrid"><form className="checkoutForm acceptanceForm" onSubmit={submit}><label htmlFor="name">Nome completo<input id="name" name="name" autoComplete="name" required value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Seu nome" /></label><label htmlFor="whatsapp">WhatsApp<input id="whatsapp" name="whatsapp" inputMode="tel" autoComplete="tel" required value={form.whatsapp} onChange={(e) => update('whatsapp', e.target.value)} placeholder="(11) 99999-9999" /></label><label htmlFor="email">Email<input id="email" name="email" required type="email" autoComplete="email" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="voce@email.com" /></label><label htmlFor="cpf">CPF<input id="cpf" name="cpf" inputMode="numeric" required value={form.cpf} onChange={(e) => update('cpf', e.target.value)} placeholder="Somente para identificação da matrícula" /></label><label htmlFor="turma">Turma<select id="turma" name="turma" value={form.turma} onChange={(e) => update('turma', e.target.value)}>{course.dates.map((date) => <option key={date}>{date}</option>)}</select></label>
    {exigeContrato && <>
      <label htmlFor="rg">RG<input id="rg" name="rg" required value={form.rg} onChange={(e) => update('rg', e.target.value)} placeholder="Número do seu RG" /></label>
      <label htmlFor="address" className="acceptanceFullWidth">Endereço completo<input id="address" name="address" autoComplete="street-address" required value={form.address} onChange={(e) => update('address', e.target.value)} placeholder="Rua, número, complemento, bairro, cidade/UF" /></label>

      <div className="contractBox">
        <div className="contractBox__head">
          <div>
            <p className="eyebrow">Contrato de matrícula</p>
            <h2>Leia e assine antes de pagar</h2>
            <p>É o contrato de prestação de serviços educacionais desta turma, já preenchido com os seus dados. A matrícula só segue para pagamento depois da sua assinatura.</p>
          </div>
          <button type="button" className="button button--outline" onClick={() => setContratoAberto((v) => !v)}>{contratoAberto ? 'Fechar contrato' : 'Ler o contrato completo'}</button>
        </div>
        {contratoAberto && <div className="contractBox__text" tabIndex="0" aria-label="Texto do contrato">{contractText(form.turma, {
          name: form.name, cpf: form.cpf, rg: form.rg, address: form.address, whatsapp: form.whatsapp, email: form.email,
          totalValue: summaryTotal || '', enrollmentValue: summaryMatricula || '', paymentTerms: voompSplit.installments || course.installments || '',
          date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }),
        }).split('\n').map((linha, indice) => <p key={`${indice}-${linha.slice(0, 24)}`}>{linha}</p>)}</div>}
        <label className="contractBox__accept"><input type="checkbox" required checked={form.contractAccepted} onChange={(e) => update('contractAccepted', e.target.checked)} /> <span>Li o contrato inteiro e aceito as condições, incluindo frequência mínima, certificação, formas de pagamento e as regras de cancelamento.</span></label>
        <label htmlFor="signedName" className="contractBox__sign">Assinatura — digite seu nome completo
          <input id="signedName" name="signedName" required value={form.signedName} onChange={(e) => update('signedName', e.target.value)} placeholder="Digite exatamente o nome completo do cadastro" autoComplete="off" />
          <small>Ao assinar, ficam registrados a data, a hora e a versão do contrato ({CONTRACT_VERSION}) que você leu.</small>
        </label>
      </div>
    </>}
    <div className="acceptanceBox"><label><input type="checkbox" required checked={form.terms} onChange={(e) => update('terms', e.target.checked)} /> <span>Li as condições de matrícula acima e entendi as informações essenciais da turma, carga horária, presença, atividades obrigatórias e regras de participação.</span></label><label><input type="checkbox" required checked={form.payment} onChange={(e) => update('payment', e.target.checked)} /> <span>Entendo que o pagamento feito agora é apenas a inscrição, e que isso não é o pagamento total do curso: as {voompSplit.parcelas} parcelas restantes, do mesmo valor e sem juros, serão cobradas depois, à parte, na forma de pagamento que eu escolher, conforme o contrato de matrícula.</span></label><label><input type="checkbox" required checked={form.rules} onChange={(e) => update('rules', e.target.checked)} /> <span>Aceito as condições de matrícula e estou ciente de que a confirmação depende da validação dos dados e do pagamento da matrícula.</span></label><label><input type="checkbox" checked={form.contact} onChange={(e) => update('contact', e.target.checked)} /> <span>Prefiro falar com o atendimento antes de efetuar o pagamento.</span></label><label><input type="checkbox" required checked={form.whatsappOptIn} onChange={(e) => update('whatsappOptIn', e.target.checked)} /> <span>Autorizo a a escola a me enviar mensagens pelo WhatsApp sobre esta matrícula, pagamento, confirmação e lembretes da turma.</span></label></div>{apiState.error && <div className="formAlert formAlert--error">{apiState.error}</div>}<button className="button button--primary" type="submit" disabled={apiState.loading || (exigeContrato && !form.contractAccepted)}>{apiState.loading ? 'Registrando assinatura...' : exigeContrato ? 'Assinar contrato e seguir para o pagamento' : 'Aceito as condições e quero continuar'}</button><a className="button button--outline" href={`https://wa.me/{WHATSAPP}?text=${encodeURIComponent(helpMessage)}`}>Falar com atendimento</a></form><aside className="orderSummary"><SafeImage src={course.image} alt={course.name} /><h3>{course.name}</h3><p>{form.turma}</p><strong>Inscrição: {summaryMatricula}</strong><small>Mais {voompSplit.parcelas}x de {summaryMatricula} (sem juros){summaryTotal ? ` · valor total ${summaryTotal}` : ''}</small><div className="safeNote">Depois do aceite, você escolhe se quer receber o próximo passo para pagamento ou falar com alguém do atendimento antes de avançar.</div></aside></div></section>;
}

export function EnrollmentPage({ course }) {
  const params = new URLSearchParams(window.location.search);
  const requestedDate = params.get('turma') || '';
  const initialDate = course.dates.includes(requestedDate) ? requestedDate : course.dates[0];
  const [form, setForm] = useState({ name: '', whatsapp: '', email: '', cpf: '', turma: initialDate, coupon: '', additionalCourseSlug: '', paymentMethod: 'pix', whatsappOptIn: true });
  const catalog = useCatalog();
  const upsellOptions = useMemo(() => eligibleAdditionalCourses(catalog, course), [catalog, course.slug]);
  const selectedUpsell = upsellOptions.find((item) => item.slug === form.additionalCourseSlug) || null;
  const [submitted, setSubmitted] = useState(false);
  const [apiState, setApiState] = useState({ loading: false, error: '', result: null });
  const submittedRef = useRef(false);
  const abandonedRef = useRef(false);
  useEffect(() => track('begin_enrollment', { course_slug: course.slug, class_date: initialDate, cart: cartSummary(course, initialDate) }), [course.slug]);
  useEffect(() => { submittedRef.current = submitted; }, [submitted]);
  useEffect(() => {
    const hasContact = form.whatsappOptIn && (form.whatsapp.replace(/\D/g, '').length >= 10 || form.email.includes('@'));
    if (!hasContact || abandonedRef.current) return undefined;
    const notifyAbandonedCart = () => {
      if (submittedRef.current || abandonedRef.current) return;
      abandonedRef.current = true;
      track('cart_abandoned', {
        course_slug: course.slug,
        course_name: course.name,
        class_date: form.turma,
        coupon: 'EBN10',
        discount_percent: 10,
        studentName: form.name,
        studentWhatsapp: form.whatsapp,
        studentEmail: form.email,
        cart: cartSummary(course, form.turma, 'EBN10'),
      });
    };
    window.addEventListener('pagehide', notifyAbandonedCart);
    return () => window.removeEventListener('pagehide', notifyAbandonedCart);
  }, [course, form.email, form.name, form.turma, form.whatsapp, form.whatsappOptIn]);
  const couponPreview = previewCheckoutCoupon(course, form);
  function update(key, value) { setForm((prev) => ({ ...prev, [key]: value })); }
  async function submit(event) {
    event.preventDefault();
    setApiState({ loading: true, error: '', result: null });
    // Mesmo id no Pixel e na API de Conversões — ver a explicação no aceite acima.
    const metaEventId = newMetaEventId('submit_lead', getAttribution().session_id);
    const payload = {
      metaEventId,
      courseSlug: course.slug,
      courseName: course.name,
      classDate: form.turma,
      studentName: form.name,
      studentEmail: form.email,
      studentWhatsapp: form.whatsapp,
      studentCpf: form.cpf,
      paymentMethod: form.paymentMethod,
      coupon: selectedUpsell ? '' : form.coupon,
      additionalCourseSlug: selectedUpsell?.slug || '',
      additionalClassDate: selectedUpsell?.date || '',
      termsVersion: 'matricula-mvp-v1-2026-06-23',
      whatsappOptIn: form.whatsappOptIn,
      cart: couponPreview.cart,
      attribution: getAttribution(),
    };
    try {
      const result = await postJson('/api/payments', payload);
      identifyForMeta({ name: form.name, email: form.email, whatsapp: form.whatsapp });
      track('submit_lead', { meta_event_id: metaEventId, course_slug: course.slug, class_date: form.turma, has_coupon: !!form.coupon, payment_method: form.paymentMethod, api_status: result.status, value: couponPreview.cart?.total || couponPreview.cart?.priceNumber });
      setApiState({ loading: false, error: '', result });
      submittedRef.current = true;
      setSubmitted(true);
    } catch (error) {
      const messages = {
        enrollment_closed: 'A matrícula dessa turma já fechou. Escolha outra data ou fale com o atendimento.',
        class_full: 'Essa turma acabou de lotar. Escolha outra data ou fale com o atendimento.',
        additional_enrollment_closed: 'A matrícula do curso adicional já fechou. Remova-o ou escolha outro.',
        additional_class_full: 'O curso adicional acabou de lotar. Remova-o ou escolha outro.',
        coupon_not_combinable_with_additional_course: 'O cupom não pode ser combinado com o curso adicional. Escolha um dos dois.',
        asaas_production_disabled: 'O checkout de pagamento está desligado em produção (configuração pendente). Fale com o atendimento para concluir a matrícula.',
        asaas_not_configured: 'O checkout de pagamento ainda não está configurado. Fale com o atendimento para concluir a matrícula.',
        database_required_before_asaas_payment: 'Não foi possível salvar a matrícula antes de cobrar. Tente novamente ou fale com o atendimento.',
      };
      setApiState({ loading: false, error: messages[error.message] || 'Não foi possível preparar a matrícula agora. Tente novamente ou fale com o atendimento.', result: null });
      track('submit_lead_error', { course_slug: course.slug, class_date: form.turma, payment_method: form.paymentMethod, error: error.message });
    }
  }
  if (submitted) return <Confirmation course={course} form={form} paymentResult={apiState.result} />;
  return <section className="section checkoutPage"><div className="checkoutIntro"><p className="eyebrow">Matrícula a escola</p><h1>Finalize sua pré-matrícula</h1><p>Preencha seus dados para reservar a vaga e seguir para o pagamento com segurança.</p></div><div className="checkoutGrid"><form className="checkoutForm" onSubmit={submit}><label htmlFor="name">Nome completo<input id="name" name="name" autoComplete="name" required value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Seu nome" /></label><label htmlFor="whatsapp">WhatsApp<input id="whatsapp" name="whatsapp" inputMode="tel" required value={form.whatsapp} onChange={(e) => update('whatsapp', e.target.value)} placeholder="(11) 99999-9999" /></label><label htmlFor="email">Email<input id="email" name="email" required type="email" value={form.email} onChange={(e) => update('email', e.target.value)} placeholder="voce@email.com" /></label><label htmlFor="cpf">CPF<input id="cpf" name="cpf" inputMode="numeric" required value={form.cpf} onChange={(e) => update('cpf', e.target.value)} placeholder="Necessário para cobrança" /></label><label htmlFor="turma">Turma<select id="turma" name="turma" value={form.turma} onChange={(e) => update('turma', e.target.value)}>{course.dates.map((date) => <option key={date}>{date}</option>)}</select></label>{upsellOptions.length > 0 && <div className="upsellOffers">
              <div className="upsellOffers__head">
                <span className="upsellOffers__label">Leve outro curso com desconto</span>
                <p>Este desconto existe só nesta matrícula, levando os dois cursos juntos. Fechando depois, o curso volta ao preço normal.</p>
              </div>
              {upsellOptions.map((item) => {
                const selected = form.additionalCourseSlug === item.slug;
                const offPercent = Math.round((1 - item.discountedPriceNumber / item.priceNumber) * 100);
                const economia = Math.round((item.priceNumber - item.discountedPriceNumber) * 100);
                return <label key={item.slug} className={selected ? 'upsellCard upsellCard--selected' : 'upsellCard'}>
                  <input type="checkbox" checked={selected} onChange={(e) => { const next = e.target.checked ? item.slug : ''; update('additionalCourseSlug', next); if (next) update('coupon', ''); }} />
                  <span className="upsellCard__cover"><SafeImage src={item.image} alt={item.name} /></span>
                  <span className="upsellCard__body">
                    <span className="upsellCard__title">
                      <strong>{item.name}</strong>
                      <em>Economize {money(economia)}</em>
                    </span>
                    {item.promise && <small className="upsellCard__promise">{item.promise}</small>}
                    <small className="upsellCard__meta">{[item.date, item.workload].filter(Boolean).join(' · ')}</small>
                    <small className="upsellCard__price">De <s>{money(Math.round(item.priceNumber * 100))}</s> por <strong>{money(Math.round(item.discountedPriceNumber * 100))}</strong> <em>({offPercent}% OFF)</em></small>
                    <small className="upsellCard__only">Só com o {course.name}. É agora ou pelo preço cheio depois.</small>
                  </span>
                </label>;
              })}
            </div>}<label htmlFor="coupon">Cupom<input id="coupon" name="coupon" value={form.coupon} disabled={Boolean(selectedUpsell)} onChange={(e) => update('coupon', e.target.value.toUpperCase())} placeholder={selectedUpsell ? 'Não combina com o curso adicional' : 'Se tiver'} /></label><label htmlFor="paymentMethod">Como prefere pagar<select id="paymentMethod" name="paymentMethod" value={form.paymentMethod} onChange={(e) => update('paymentMethod', e.target.value)}><option value="pix">Pix</option><option value="boleto">Boleto</option><option value="credit_card">Cartão de crédito (página segura da Asaas)</option></select></label>{form.paymentMethod === 'credit_card' && <div className="variantNote">Você será direcionado para uma página segura da Asaas para digitar os dados do cartão — eles nunca passam pelo site da escola.</div>}<label className="optInLine"><input type="checkbox" required checked={form.whatsappOptIn} onChange={(e) => update('whatsappOptIn', e.target.checked)} /> <span>Autorizo a a escola a me enviar mensagens pelo WhatsApp sobre esta matrícula, pagamento, confirmação e lembretes da turma.</span></label>{couponPreview.label && <div className={couponPreview.valid ? 'formAlert formAlert--success' : 'formAlert formAlert--error'}>{couponPreview.label}</div>}{apiState.error && <div className="formAlert formAlert--error">{apiState.error}</div>}<button className="button button--primary" type="submit" disabled={apiState.loading}>{apiState.loading ? 'Preparando matrícula...' : 'Continuar para pagamento'}</button><a className="button button--outline" href={whatsappLink(course, form.turma)}>Tenho dúvida antes de pagar</a></form><aside className="orderSummary"><SafeImage src={course.image} alt={course.name} /><h3>{course.name}</h3><p>{form.turma}</p><strong>{selectedUpsell ? money(Math.round((displayPriceNumber(course, form.turma) + selectedUpsell.discountedPriceNumber) * 100)) : couponPreview.cart.price}</strong><small>{selectedUpsell ? `Inclui ${selectedUpsell.name} com desconto` : couponPreview.valid && couponPreview.cart.discount ? `De ${displayPrice(course, form.turma)} por ${couponPreview.cart.price}` : (selectedOffer(course, form.turma)?.label || course.installments)}</small>{selectedUpsell && <div className="formAlert formAlert--success">{course.name}: {displayPrice(course, form.turma)} + {selectedUpsell.name}: de {money(Math.round(selectedUpsell.priceNumber * 100))} por {money(Math.round(selectedUpsell.discountedPriceNumber * 100))} ({Math.round((1 - selectedUpsell.discountedPriceNumber / selectedUpsell.priceNumber) * 100)}% OFF)</div>}<div className="checkoutUpsell"><span>Benefício a escola</span><strong>Desbloqueie vantagens para o próximo curso</strong><p>Depois da matrícula confirmada, a aluna acessa a Minha Área para cumprir missões, liberar selos e ganhar benefícios como descontos, aula online, vivência ou brindes.</p></div><div className="safeNote">Pagamento seguro por Pix, boleto ou cartão. Seus dados serão usados apenas para concluir a matrícula.</div></aside></div></section>;
}

export function Confirmation({ course, form, paymentResult }) {
  useEffect(() => track('create_payment_mock', { course_slug: course.slug, class_date: form.turma }), []);
  const cardCheckoutUrl = form.paymentMethod === 'credit_card' ? paymentResult?.checkout?.url : '';
  useEffect(() => {
    if (!cardCheckoutUrl) return undefined;
    const timer = window.setTimeout(() => { window.location.href = cardCheckoutUrl; }, 900);
    return () => window.clearTimeout(timer);
  }, [cardCheckoutUrl]);
  const pixQrCode = paymentResult?.payment?.pixQrCode && !paymentResult.payment.pixQrCode.error ? paymentResult.payment.pixQrCode : null;
  const pixPayload = pixQrCode?.payload || '';
  const pixImage = pixQrCode?.encodedImage ? `data:image/png;base64,${pixQrCode.encodedImage}` : '';
  const boletoInfo = paymentResult?.payment?.billingInfo && !paymentResult.payment.billingInfo.error ? paymentResult.payment.billingInfo : null;
  const boletoLine = boletoInfo?.identificationField || boletoInfo?.digitableLine || boletoInfo?.barCode || boletoInfo?.nossoNumero || '';
  const isSandbox = paymentResult?.mode === 'sandbox';
  return <section className="section confirmPage"><div className="confirmCard"><p className="eyebrow">Pré-matrícula recebida</p><h1>{cardCheckoutUrl ? 'Abrindo pagamento seguro no cartão' : 'Agora falta o pagamento'}</h1><p>{form.name || 'Seu cadastro'} foi registrado para <strong>{course.name}</strong>, turma <strong>{form.turma}</strong>.</p>{pixQrCode ? <div className="transparentPayment"><p>{isSandbox ? 'Pix de teste gerado com sucesso.' : 'Pix gerado com segurança.'} Você pode pagar por QR Code ou copia e cola.</p>{pixImage && <img src={pixImage} alt="QR Code Pix" />}{pixPayload && <textarea readOnly value={pixPayload} aria-label="Código Pix copia e cola" />}</div> : boletoInfo ? <div className="transparentPayment"><p>Boleto gerado com segurança. Use a linha abaixo para pagar no seu banco.</p>{boletoLine && <textarea readOnly value={boletoLine} aria-label="Linha digitável do boleto" />}</div> : cardCheckoutUrl ? <div className="transparentPayment"><p>Vou te direcionar para a página segura da Asaas para concluir o pagamento no cartão. Se não abrir automaticamente, toque no botão abaixo.</p><a className="button button--primary" href={cardCheckoutUrl}>Abrir pagamento no cartão</a></div> : <p>Recebemos seus dados. Se o pagamento não aparecer, fale com o atendimento para concluir a matrícula.</p>}<div className="confirmActions"><a className="button button--outline" href={whatsappLink(course, form.turma)}>Falar com atendimento</a><a className="button button--outline" href="/">Voltar para agenda</a></div></div></section>;
}

export function WaitlistPage() {
  const catalog = useCatalog();
  const params = new URLSearchParams(window.location.search);
  const courseSlug = params.get('course') || params.get('curso') || '';
  const classDate = params.get('turma') || '';
  const course = findPublicCourse(courseSlug, catalog || courses);
  const [form, setForm] = useState({ name: '', whatsapp: '', email: '' });
  const [status, setStatus] = useState({ loading: false, error: '', success: false });

  async function submit(event) {
    event.preventDefault();
    setStatus({ loading: true, error: '', success: false });
    try {
      await postJson('/api/waitlist', { courseSlug, classDate, name: form.name, whatsapp: form.whatsapp, email: form.email });
      setStatus({ loading: false, error: '', success: true });
      track('join_waitlist', { course_slug: courseSlug, class_date: classDate });
    } catch (error) {
      const messages = { invalid_waitlist_payload: 'Preencha nome e um WhatsApp válido.', class_date_not_found: 'Não encontrei essa turma — volte para a agenda e tente de novo.' };
      setStatus({ loading: false, error: messages[error.message] || 'Não consegui te colocar na fila agora. Tente pelo WhatsApp.', success: false });
    }
  }

  if (!courseSlug || !course) {
    return <section className="section confirmPage"><div className="confirmCard"><p className="eyebrow">Lista de espera</p><h1>Avise quando abrir nova turma</h1><p>Escolha um curso na agenda pra entrar na fila de espera dessa turma.</p><a className="button button--primary" href="/#agenda">Ver agenda de cursos</a><a className="button button--outline" href={whatsappLink({ name: 'lista de espera da escola' })}>Falar no WhatsApp</a></div></section>;
  }

  if (status.success) {
    return <section className="section confirmPage"><div className="confirmCard"><p className="eyebrow">Lista de espera</p><h1>Você está na fila!</h1><p>Assim que uma vaga abrir na turma <strong>{classDate}</strong> de <strong>{course.name}</strong>, avisamos você direto no WhatsApp, por ordem de chegada.</p><a className="button button--outline" href="/">Voltar para agenda</a></div></section>;
  }

  return <section className="section confirmPage"><div className="confirmCard"><p className="eyebrow">Lista de espera</p><h1>Entrar na fila da turma</h1><p><strong>{course.name}</strong> — turma {classDate} está lotada. Deixe seus dados e avisamos automaticamente pelo WhatsApp assim que abrir uma vaga.</p>
    <form className="studentLoginForm" onSubmit={submit}>
      <label htmlFor="waitlistName">Nome completo<input id="waitlistName" required value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} /></label>
      <label htmlFor="waitlistWhatsapp">WhatsApp<input id="waitlistWhatsapp" required inputMode="tel" placeholder="(11) 91234-5678" value={form.whatsapp} onChange={(e) => setForm((prev) => ({ ...prev, whatsapp: e.target.value }))} /></label>
      <label htmlFor="waitlistEmail">E-mail (opcional)<input id="waitlistEmail" type="email" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} /></label>
      {status.error && <div className="formAlert formAlert--error">{status.error}</div>}
      <button type="submit" className="button button--primary" disabled={status.loading}>{status.loading ? 'Entrando na fila...' : 'Entrar na lista de espera'}</button>
    </form>
    <a className="button button--outline" href={whatsappLink(course, classDate)}>Prefiro falar no WhatsApp</a>
  </div></section>;
}

export function VoompReturnPage() {
  const [state, setState] = useState({ loading: true, ok: false });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payload = {
      event: 'voomp_checkout_return',
      status: params.get('status') || 'returned_from_checkout',
      courseSlug: params.get('course') || '',
      classDate: params.get('turma') || '',
      checkoutId: params.get('checkout_id') || params.get('id') || '',
      paymentId: params.get('payment_id') || params.get('transaction_id') || '',
      attribution: { ...getAttribution(), session_id: params.get('session_id') || getAttribution().session_id },
      url: window.location.href,
    };
    postJson('/api/voomp/return', payload)
      .then(() => setState({ loading: false, ok: true }))
      .catch(() => setState({ loading: false, ok: false }));
  }, []);
  return <section className="section confirmPage"><div className="confirmCard"><p className="eyebrow">Checkout Voomp</p><h1>Recebemos seu retorno do checkout</h1><p>{state.loading ? 'Registrando as informações para o atendimento...' : state.ok ? 'A escola recebeu o status e pode continuar o atendimento pelo WhatsApp.' : 'Não consegui registrar automaticamente, mas você pode falar com o atendimento para concluir.'}</p><div className="confirmActions"><a className="button button--primary" href={whatsappLink({ name: 'matrícula Voomp' })}>Falar com atendimento</a><a className="button button--outline" href="/">Voltar para agenda</a></div></div></section>;
}

export function AsaasCheckoutReturnPage() {
  const [state, setState] = useState({ loading: true, ok: false });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payload = {
      status: params.get('status') || 'returned_from_checkout',
      courseSlug: params.get('course') || '',
      classDate: params.get('turma') || '',
      attribution: { ...getAttribution(), session_id: params.get('session_id') || getAttribution().session_id },
      url: window.location.href,
    };
    postJson('/api/asaas/checkout-return', payload)
      .then(() => setState({ loading: false, ok: true }))
      .catch(() => setState({ loading: false, ok: false }));
  }, []);
  return <section className="section confirmPage"><div className="confirmCard"><p className="eyebrow">Pagamento no cartão</p><h1>Recebemos seu retorno do pagamento</h1><p>{state.loading ? 'Registrando as informações...' : 'A confirmação definitiva do pagamento chega em instantes pelo WhatsApp, assim que a Asaas confirmar.'}</p><div className="confirmActions"><a className="button button--primary" href={whatsappLink({ name: 'matrícula a escola' })}>Falar com atendimento</a><a className="button button--outline" href="/">Voltar para agenda</a></div></div></section>;
}
