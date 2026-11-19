/* ==========================================================================
   Áurea Odontologia — script.js
   Fluxo de reserva em 3 passos, horários dinâmicos, confirmação por WhatsApp,
   convite de agenda (.ics / Google Agenda) e "Minhas consultas".

   COMO PERSONALIZAR: edite apenas o bloco CONFIGURAÇÃO logo abaixo.
   ========================================================================== */
(() => {
  'use strict';

  /* ===================== CONFIGURAÇÃO ===================== */

  // Horários de atendimento, em minutos desde 00:00 (ex.: 8 * 60 = 08:00).
  const WEEKDAY = [[8 * 60, 12 * 60], [13 * 60 + 30, 18 * 60 + 30]]; // 08:00–12:00 e 13:30–18:30
  const SATURDAY = [[8 * 60, 12 * 60]];                              // 08:00–12:00

  const CLINIC = {
    name: 'HS Odontologia',
    whatsapp: '5567982082262',                 // DDI + DDD + número, só dígitos. TROQUE pelo número real.
    address: 'Rua Ceará, 1042 · Vila Barbosa, Aparecida do Taboado, MS',
    slotGrid: 30,                              // intervalo entre horários, em minutos
    leadMinutes: 60,                           // antecedência mínima para reservar no mesmo dia
    daysAhead: 28,                             // quantos dias à frente a agenda fica aberta
    // Demonstração: marca alguns horários como ocupados para a agenda parecer real.
    // Ao ligar um sistema de agenda de verdade, coloque false.
    simulateOccupancy: true,
    occupancyRate: 30,                         // % de horários "ocupados" na simulação
    hours: { 0: [], 1: WEEKDAY, 2: WEEKDAY, 3: WEEKDAY, 4: WEEKDAY, 5: WEEKDAY, 6: SATURDAY }, // 0 = domingo
  };

  // O primeiro item é usado na "primeira visita" do cartão do topo.
  const TREATMENTS = [
    { id: 'avaliacao',   name: 'Avaliação inicial',      duration: 30, icon: 'search',  desc: 'Conversa, exame clínico e um plano de cuidado feito sob medida para você.' },
    { id: 'limpeza',     name: 'Limpeza e prevenção',    duration: 60, icon: 'drop',    desc: 'Remoção de placa e tártaro, polimento e orientações para o dia a dia.' },
    { id: 'clareamento', name: 'Clareamento dental',     duration: 60, icon: 'sparkle', desc: 'Sorriso mais luminoso, com avaliação prévia e acompanhamento.' },
    { id: 'ortodontia',  name: 'Ortodontia',             duration: 30, icon: 'smile',   desc: 'Consulta para entender as opções de alinhamento dos dentes.' },
    { id: 'implantes',   name: 'Implantes',              duration: 30, icon: 'implant', desc: 'Avaliação para repor dentes com planejamento detalhado e seguro.' },
    { id: 'restauracao', name: 'Restaurações e dentística', duration: 60, icon: 'tooth', desc: 'Cuidado para devolver forma, função e naturalidade aos dentes.' },
  ];

  /* ===================== UTILITÁRIOS ===================== */

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const pad = (n) => String(n).padStart(2, '0');
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const daysFromToday = (d) => Math.round((d - startOfToday()) / 86400000);

  const fmtTime = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const fmtShort = (m) => (m % 60 ? `${Math.floor(m / 60)}h${pad(m % 60)}` : `${Math.floor(m / 60)}h`);
  const fmtLong = (d) => cap(new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(d));
  const weekdayShort = (d) => cap(new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(d).replace('.', ''));
  const monthShort = (d) => new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(d).replace('.', '');
  const durationLabel = (m) => (m % 60 === 0 ? `≈ ${m / 60} ${m / 60 === 1 ? 'hora' : 'horas'}` : `≈ ${m} min`);
  const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;

  function relLabel(d) {
    const diff = daysFromToday(d);
    if (diff === 0) return 'Hoje';
    if (diff === 1) return 'Amanhã';
    return `${weekdayShort(d)}, ${d.getDate()} ${monthShort(d)}`;
  }

  /* ===================== AGENDA (dados) ===================== */

  const STORE_KEY = 'aurea.bookings.v1';
  let bookings = loadBookings();
  let booked = new Set();

  function loadBookings() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
  }
  function saveBookings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(bookings)); } catch { /* armazenamento indisponível: segue só em memória */ }
  }
  function rebuildBooked() {
    booked = new Set();
    bookings.forEach((b) => { for (let t = b.start; t < b.start + b.duration; t += CLINIC.slotGrid) booked.add(`${b.date}|${t}`); });
  }

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  const simBusy = (key, t) => CLINIC.simulateOccupancy && hash(`${key}|${t}`) % 100 < CLINIC.occupancyRate;

  function isFree(date, start, duration) {
    const key = ymd(date);
    const end = start + duration;
    const blocks = CLINIC.hours[date.getDay()] || [];
    if (!blocks.some(([a, b]) => start >= a && end <= b)) return false;
    if (daysFromToday(date) === 0) {
      const now = new Date();
      if (start < now.getHours() * 60 + now.getMinutes() + CLINIC.leadMinutes) return false;
    }
    for (let t = start; t < end; t += CLINIC.slotGrid) {
      if (booked.has(`${key}|${t}`) || simBusy(key, t)) return false;
    }
    return true;
  }
  function slotsFor(date, duration) {
    const out = [];
    (CLINIC.hours[date.getDay()] || []).forEach(([a, b]) => {
      for (let t = a; t + duration <= b; t += CLINIC.slotGrid) if (isFree(date, t, duration)) out.push(t);
    });
    return out;
  }
  function openDays() {
    const out = [];
    for (let i = 0; i < CLINIC.daysAhead; i++) {
      const d = addDays(startOfToday(), i);
      if ((CLINIC.hours[d.getDay()] || []).length) out.push(d);
    }
    return out;
  }

  /* ===================== ESTADO ===================== */

  const state = { step: 1, treatmentId: null, date: null, time: null };
  const treatment = () => TREATMENTS.find((t) => t.id === state.treatmentId) || null;
  const form = $('#bookingForm');

  /* ===================== WHATSAPP ===================== */

  const waLink = (text) => `https://wa.me/${CLINIC.whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  function wireWhatsApp(root = document) {
    $$('[data-whatsapp]', root).forEach((a) => {
      a.href = waLink('Olá! Gostaria de falar com a clínica.');
      a.target = '_blank';
      a.rel = 'noopener';
    });
  }

  /* ===================== RENDER: PROCEDIMENTOS ===================== */

  function renderTreatmentList() {
    $('#treatmentList').innerHTML = TREATMENTS.map((t) => `
      <li class="treat-row">
        <span class="treat-icon">${icon(t.icon)}</span>
        <div class="treat-main"><h3>${esc(t.name)}</h3><p>${esc(t.desc)}</p></div>
        <span class="treat-time">${icon('clock')}${durationLabel(t.duration)}</span>
        <button type="button" class="btn btn-outline btn-sm" data-treatment="${t.id}" aria-label="Agendar ${esc(t.name)}">Agendar</button>
      </li>`).join('');
  }

  function renderTreatmentOptions() {
    $('#treatmentOptions').innerHTML = TREATMENTS.map((t) => `
      <label class="opt">
        <input type="radio" name="treatment" value="${t.id}" ${state.treatmentId === t.id ? 'checked' : ''}>
        <span class="opt-body">
          <span class="opt-icon">${icon(t.icon)}</span>
          <span class="opt-text"><strong>${esc(t.name)}</strong><small>${durationLabel(t.duration)}</small></span>
        </span>
      </label>`).join('');
  }

  /* ===================== RENDER: DATAS E HORÁRIOS ===================== */

  function ensureDate() {
    const t = treatment();
    if (!t) return;
    const valid = state.date && slotsFor(parseYmd(state.date), t.duration).length > 0;
    if (!valid) {
      const first = openDays().find((d) => slotsFor(d, t.duration).length > 0);
      state.date = first ? ymd(first) : null;
      state.time = null;
    } else if (state.time !== null && !isFree(parseYmd(state.date), state.time, t.duration)) {
      state.time = null;
    }
  }

  function renderDates() {
    const t = treatment();
    const strip = $('#dateStrip');
    strip.innerHTML = openDays().map((d) => {
      const key = ymd(d);
      const free = slotsFor(d, t.duration).length > 0;
      const diff = daysFromToday(d);
      const wd = diff === 0 ? 'Hoje' : diff === 1 ? 'Amanhã' : weekdayShort(d);
      return `
        <label class="chip day">
          <input type="radio" name="date" value="${key}" ${free ? '' : 'disabled'} ${state.date === key ? 'checked' : ''}
                 aria-label="${fmtLong(d)}${free ? '' : ', sem vagas'}">
          <span class="chip-body"><small>${wd}</small><strong>${d.getDate()}</strong><small>${monthShort(d)}</small>${free ? '' : '<em>sem vagas</em>'}</span>
        </label>`;
    }).join('');
    const checked = $('input:checked', strip);
    if (checked) {
      const chip = checked.closest('.chip');
      strip.scrollLeft = Math.max(0, chip.offsetLeft - strip.clientWidth / 2 + chip.clientWidth / 2);
    }
  }

  function renderSlots() {
    const wrap = $('#slotsWrap');
    const t = treatment();
    if (!state.date) {
      wrap.innerHTML = '<p class="hint">Não há horários online disponíveis neste momento. Fale com a clínica pelo WhatsApp.</p>';
      return;
    }
    const date = parseYmd(state.date);
    const slots = slotsFor(date, t.duration);
    if (!slots.length) {
      wrap.innerHTML = '<p class="hint">Sem horários neste dia. Escolha outra data.</p>';
      return;
    }
    const groups = [['Manhã', slots.filter((s) => s < 12 * 60)], ['Tarde', slots.filter((s) => s >= 12 * 60)]].filter(([, l]) => l.length);
    wrap.innerHTML = `<p class="slots-title">${fmtLong(date)}</p>` + groups.map(([name, list]) => `
      <div class="slot-group">
        <h4>${name}</h4>
        <div class="slots" role="radiogroup" aria-label="Horários da ${name.toLowerCase()}">
          ${list.map((m) => `
            <label class="chip slot">
              <input type="radio" name="time" value="${m}" ${state.time === m ? 'checked' : ''}>
              <span class="chip-body">${fmtTime(m)}</span>
            </label>`).join('')}
        </div>
      </div>`).join('');
  }

  /* ===================== RENDER: CARTÃO DO TOPO ===================== */

  function renderQuickSlots() {
    const list = $('#quickSlots');
    const count = $('#quickCount');
    const duration = TREATMENTS[0].duration;
    const picks = [];
    let week = 0;
    openDays().forEach((d) => {
      const slots = slotsFor(d, duration);
      if (daysFromToday(d) < 7) week += slots.length;
      let last = -999;
      slots.forEach((s) => {
        if (picks.length < 3 && s - last >= 90) { picks.push({ d, s }); last = s; }
      });
    });
    if (!picks.length) {
      list.innerHTML = '<li class="quick-empty">Sem horários online no momento. <a data-whatsapp href="#">Fale com a clínica</a>.</li>';
      count.textContent = '';
      wireWhatsApp(list);
      return;
    }
    list.innerHTML = picks.map(({ d, s }) => `
      <li>
        <button type="button" class="quick-slot" data-date="${ymd(d)}" data-time="${s}" aria-label="Reservar ${relLabel(d)} às ${fmtShort(s)}">
          <span class="qs-time">${fmtShort(s)}</span>
          <span class="qs-day">${relLabel(d)}${icon('arrow-ur')}</span>
        </button>
      </li>`).join('');
    count.textContent = week === 1 ? '1 horário nesta semana' : `${week} horários nesta semana`;
  }

  /* ===================== NAVEGAÇÃO ENTRE PASSOS ===================== */

  function updateSummary() {
    const t = treatment();
    $('#sumTreatment').textContent = t ? t.name : '—';
    $('#sumDate').textContent = state.date ? fmtLong(parseYmd(state.date)) : '—';
    $('#sumTime').textContent = state.time !== null ? fmtTime(state.time) : '—';
    $('#sumDuration').textContent = t ? durationLabel(t.duration) : '—';
  }

  function updateStepper() {
    $$('#stepper li').forEach((li) => {
      const k = Number(li.dataset.step);
      li.classList.toggle('is-current', k === state.step);
      li.classList.toggle('is-done', k < state.step);
      const btn = $('button', li);
      btn.disabled = k > state.step;
      if (k === state.step) btn.setAttribute('aria-current', 'step'); else btn.removeAttribute('aria-current');
    });
  }

  function updateNav() {
    const ready = state.step === 1 ? !!treatment() : state.step === 2 ? !!state.date && state.time !== null : true;
    $('#btnBack').hidden = state.step === 1;
    $('#btnNext').disabled = !ready;
    $('#btnNextLabel').textContent = state.step === 3 ? 'Confirmar agendamento' : 'Continuar';
    $('#btnNext use').setAttribute('href', state.step === 3 ? '#i-check' : '#i-arrow-r');
  }

  function goTo(n, { focus = true } = {}) {
    state.step = n;
    $$('.step', form).forEach((s) => { s.hidden = Number(s.dataset.step) !== n; });
    if (n === 2) { ensureDate(); renderDates(); renderSlots(); }
    updateStepper();
    updateNav();
    updateSummary();
    if (focus) {
      const title = $(`.step[data-step="${n}"] .step-title`, form);
      if (title) title.focus({ preventScroll: true });
    }
  }

  function showForm() {
    $('#success').hidden = true;
    form.hidden = false;
    $('#stepper').hidden = false;
  }

  function scrollToBooking() {
    $('#bookingCard').scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth', block: 'start' });
  }

  function onNext() {
    if (state.step === 1 && treatment()) goTo(2);
    else if (state.step === 2 && state.date && state.time !== null) goTo(3);
    else if (state.step === 3) confirmBooking();
  }

  /* ===================== VALIDAÇÃO E ENVIO ===================== */

  function maskPhone(v) {
    const d = v.replace(/\D/g, '').slice(0, 11);
    if (!d.length) return '';
    if (d.length <= 2) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  function setError(input, msg) {
    const out = $(`#${input.id.replace('f-', 'err-')}`);
    if (out) out.textContent = msg || '';
    if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  }

  function validateDetails() {
    const name = $('#f-name'), phone = $('#f-phone'), email = $('#f-email'), consent = $('#f-consent');
    let first = null;
    const check = (el, ok, msg) => { setError(el, ok ? '' : msg); if (!ok && !first) first = el; };
    check(name, name.value.trim().length >= 3, 'Informe seu nome completo.');
    const digits = phone.value.replace(/\D/g, '');
    check(phone, digits.length === 10 || digits.length === 11, 'Informe um WhatsApp válido, com DDD.');
    check(email, !email.value.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim()), 'Confira o e-mail informado.');
    check(consent, consent.checked, 'Marque a autorização para podermos confirmar sua consulta.');
    if (first) first.focus();
    return !first;
  }

  const makeCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return `AUR-${out}`;
  };

  /* Ponto de integração: troque por uma chamada ao seu sistema de agenda.
     Exemplo:
       const res = await fetch('/api/agendamentos', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(booking),
       });
       if (!res.ok) throw new Error('Falha ao agendar');
  */
  function submitBooking() {
    return new Promise((resolve) => setTimeout(resolve, 600));
  }

  async function confirmBooking() {
    if (!validateDetails()) return;
    const t = treatment();
    bookings = loadBookings();      // sincroniza com outras abas
    rebuildBooked();
    const date = parseYmd(state.date);
    if (!isFree(date, state.time, t.duration)) {
      toast('Esse horário acabou de ser ocupado. Escolha outro.');
      state.time = null;
      goTo(2);
      return;
    }
    const booking = {
      id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()),
      code: makeCode(),
      treatmentId: t.id,
      treatmentName: t.name,
      duration: t.duration,
      date: state.date,
      start: state.time,
      name: $('#f-name').value.trim(),
      phone: $('#f-phone').value.trim(),
      email: $('#f-email').value.trim(),
      patient: (form.elements.patient || {}).value || 'nao',
      notes: $('#f-notes').value.trim(),
      createdAt: new Date().toISOString(),
    };

    const btn = $('#btnNext');
    const label = $('#btnNextLabel');
    btn.disabled = true;
    label.textContent = 'Confirmando…';
    try {
      await submitBooking(booking);
    } catch {
      toast('Não foi possível concluir agora. Tente de novo ou chame a clínica no WhatsApp.');
      updateNav();
      return;
    }
    bookings.push(booking);
    saveBookings();
    rebuildBooked();
    showSuccess(booking);
    renderQuickSlots();
    updateMyBookingsButton();
  }

  /* ===================== CONFIRMAÇÃO ===================== */

  const stamp = (dateStr, min) => `${dateStr.replace(/-/g, '')}T${pad(Math.floor(min / 60))}${pad(min % 60)}00`;

  function waConfirmText(b) {
    return [
      'Olá! Acabei de agendar pelo site.',
      '',
      `• Procedimento: ${b.treatmentName}`,
      `• Data: ${fmtLong(parseYmd(b.date))}`,
      `• Horário: ${fmtTime(b.start)}`,
      `• Nome: ${b.name}`,
      `• Código: ${b.code}`,
      '',
      'Podem confirmar?',
    ].join('\n');
  }

  function gcalLink(b) {
    const p = new URLSearchParams({
      action: 'TEMPLATE',
      text: `${b.treatmentName} · ${CLINIC.name}`,
      dates: `${stamp(b.date, b.start)}/${stamp(b.date, b.start + b.duration)}`,
      details: `Código da reserva: ${b.code}`,
      location: CLINIC.address,
    });
    return `https://calendar.google.com/calendar/render?${p}`;
  }

  function buildIcs(b) {
    const n = new Date();
    const utc = `${n.getUTCFullYear()}${pad(n.getUTCMonth() + 1)}${pad(n.getUTCDate())}T${pad(n.getUTCHours())}${pad(n.getUTCMinutes())}${pad(n.getUTCSeconds())}Z`;
    const t = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Aurea Odontologia//Agendamento//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${b.id}@aurea-odontologia`,
      `DTSTAMP:${utc}`,
      `DTSTART:${stamp(b.date, b.start)}`,
      `DTEND:${stamp(b.date, b.start + b.duration)}`,
      `SUMMARY:${t(`${b.treatmentName} · ${CLINIC.name}`)}`,
      `LOCATION:${t(CLINIC.address)}`,
      `DESCRIPTION:${t(`Código da reserva: ${b.code}`)}`,
      'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', 'DESCRIPTION:Consulta amanhã', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
  }

  function downloadIcs(b) {
    const blob = new Blob([buildIcs(b)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `consulta-${b.code}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  let lastBooking = null;
  function showSuccess(b) {
    lastBooking = b;
    form.hidden = true;
    $('#stepper').hidden = true;
    $('#success').hidden = false;
    $('#sCode').textContent = b.code;
    $('#sTreatment').textContent = b.treatmentName;
    $('#sDate').textContent = fmtLong(parseYmd(b.date));
    $('#sTime').textContent = fmtTime(b.start);
    $('#sName').textContent = b.name;
    $('#aWhats').href = waLink(waConfirmText(b));
    $('#aGcal').href = gcalLink(b);
    $('#successTitle').focus({ preventScroll: true });
    scrollToBooking();
  }

  function resetFlow() {
    state.treatmentId = null; state.date = null; state.time = null;
    form.reset();
    $$('[aria-invalid]', form).forEach((el) => setError(el, ''));
    showForm();
    renderTreatmentOptions();
    goTo(1, { focus: false });
    updateSummary();
  }

  /* ===================== MINHAS CONSULTAS ===================== */

  const myDialog = $('#myDialog');
  const futureBookings = () => {
    const now = Date.now();
    return bookings
      .filter((b) => parseYmd(b.date).getTime() + b.start * 60000 >= now)
      .sort((a, b) => (a.date + String(a.start).padStart(4, '0')).localeCompare(b.date + String(b.start).padStart(4, '0')));
  };

  function updateMyBookingsButton() {
    const n = futureBookings().length;
    $('#myCount').textContent = n;
    $('#myBookingsBtn').hidden = n === 0;
  }

  function renderMyBookings() {
    const list = futureBookings();
    $('#myList').innerHTML = list.length
      ? list.map((b) => `
          <li class="my-item">
            <div class="my-meta">
              <strong>${esc(b.treatmentName)}</strong>
              <span>${fmtLong(parseYmd(b.date))} às ${fmtTime(b.start)}</span>
              <small>${esc(b.code)}</small>
            </div>
            <button type="button" class="link-danger" data-cancel="${esc(b.id)}">Cancelar</button>
          </li>`).join('')
      : '<li class="my-empty">Você ainda não tem consultas reservadas neste navegador.</li>';
  }

  function openMyBookings() {
    bookings = loadBookings();
    rebuildBooked();
    renderMyBookings();
    if (typeof myDialog.showModal === 'function') myDialog.showModal(); else myDialog.setAttribute('open', '');
  }

  function cancelBooking(id) {
    bookings = bookings.filter((b) => b.id !== id);
    saveBookings();
    rebuildBooked();
    renderMyBookings();
    updateMyBookingsButton();
    renderQuickSlots();
    if (state.step === 2 && !form.hidden) { ensureDate(); renderDates(); renderSlots(); updateNav(); updateSummary(); }
    toast('Consulta cancelada.');
  }

  /* ===================== AVISO (TOAST) ===================== */

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-show'), 4200);
  }

  /* ===================== EVENTOS ===================== */

  // Escolhas dentro do formulário
  form.addEventListener('change', (e) => {
    const el = e.target;
    if (el.name === 'treatment') {
      state.treatmentId = el.value;
      const t = treatment();
      if (state.date && state.time !== null && !isFree(parseYmd(state.date), state.time, t.duration)) state.time = null;
    } else if (el.name === 'date') {
      state.date = el.value;
      state.time = null;
      renderSlots();
    } else if (el.name === 'time') {
      state.time = Number(el.value);
    } else {
      return;
    }
    updateSummary();
    updateNav();
  });

  form.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'f-phone') el.value = maskPhone(el.value);
    if (el.hasAttribute('aria-invalid')) setError(el, '');
  });
  form.addEventListener('change', (e) => { if (e.target.id === 'f-consent' && e.target.checked) setError(e.target, ''); });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input[type="text"], input[type="tel"], input[type="email"]')) {
      e.preventDefault();
      onNext();
    }
  });

  $('#btnNext').addEventListener('click', onNext);
  $('#btnBack').addEventListener('click', () => goTo(Math.max(1, state.step - 1)));
  $$('#stepper button').forEach((btn) => btn.addEventListener('click', () => {
    const k = Number(btn.closest('li').dataset.step);
    if (k < state.step) goTo(k);
  }));

  const stripScroll = (dir) => $('#dateStrip').scrollBy({ left: dir * $('#dateStrip').clientWidth * 0.8, behavior: prefersReduced() ? 'auto' : 'smooth' });
  $('#datePrev').addEventListener('click', () => stripScroll(-1));
  $('#dateNext').addEventListener('click', () => stripScroll(1));

  // Procedimento escolhido na lista da página
  $('#treatmentList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-treatment]');
    if (!btn) return;
    showForm();
    state.treatmentId = btn.dataset.treatment;
    renderTreatmentOptions();
    goTo(2, { focus: false });
    scrollToBooking();
  });

  // Horário escolhido no cartão do topo
  $('#quickSlots').addEventListener('click', (e) => {
    const btn = e.target.closest('.quick-slot');
    if (!btn) return;
    showForm();
    state.treatmentId = TREATMENTS[0].id;
    state.date = btn.dataset.date;
    state.time = Number(btn.dataset.time);
    renderTreatmentOptions();
    goTo(3, { focus: false });
    scrollToBooking();
    setTimeout(() => $('#f-name').focus({ preventScroll: true }), prefersReduced() ? 0 : 500);
  });

  // Confirmação
  $('#btnIcs').addEventListener('click', () => lastBooking && downloadIcs(lastBooking));
  $('#btnNew').addEventListener('click', () => { resetFlow(); scrollToBooking(); });

  // Minhas consultas
  $('#myBookingsBtn').addEventListener('click', openMyBookings);
  $$('[data-open-bookings]').forEach((b) => b.addEventListener('click', openMyBookings));
  $('#myClose').addEventListener('click', () => myDialog.close());
  myDialog.addEventListener('click', (e) => {
    const r = myDialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) myDialog.close();
  });
  $('#myList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cancel]');
    if (!btn) return;
    if (btn.dataset.armed) { cancelBooking(btn.dataset.cancel); return; }
    btn.dataset.armed = '1';
    btn.textContent = 'Confirmar cancelamento';
    btn.classList.add('is-armed');
    setTimeout(() => {
      if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'Cancelar'; btn.classList.remove('is-armed'); }
    }, 4000);
  });

  // Menu móvel
  const nav = $('#nav');
  const navToggle = $('#navToggle');
  const setNav = (open) => {
    nav.classList.toggle('is-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  };
  navToggle.addEventListener('click', () => setNav(!nav.classList.contains('is-open')));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) setNav(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setNav(false); });

  // Sincroniza abas e mantém o cartão do topo atualizado
  window.addEventListener('storage', (e) => {
    if (e.key !== STORE_KEY) return;
    bookings = loadBookings();
    rebuildBooked();
    renderQuickSlots();
    updateMyBookingsButton();
    if (state.step === 2 && !form.hidden) { ensureDate(); renderDates(); renderSlots(); updateNav(); updateSummary(); }
  });
  setInterval(renderQuickSlots, 60000);

  /* ===================== INÍCIO ===================== */

  rebuildBooked();
  wireWhatsApp();
  renderTreatmentList();
  renderTreatmentOptions();
  renderQuickSlots();
  updateMyBookingsButton();
  goTo(1, { focus: false });
  $('#year').textContent = new Date().getFullYear();
})();
