'use strict';

/* ─────────────────────────────────────────────────────────────
   Preventivi AI — chat iterativa + documento a blocchi
   ───────────────────────────────────────────────────────────── */

const $ = (id) => document.getElementById(id);

/* Se una chiamata API risponde 401 la sessione è scaduta: torna al login.
   Il promise non si risolve mai: il redirect interrompe qualunque flusso in corso. */
const fetchOriginale = window.fetch.bind(window);
window.fetch = async (...args) => {
  const risposta = await fetchOriginale(...args);
  if (risposta.status === 401) {
    window.location.replace('/login');
    return new Promise(() => {});
  }
  return risposta;
};

/* ── stato ── */
const state = {
  messaggi: [],
  documento: null,
  salvatoId: null,
  legacy: null,
  lavoroInCorso: false,
};

const ETICHETTE_TIPO = {
  titolo: 'Titolo',
  testo: 'Paragrafo',
  elenco: 'Elenco',
  fasi: 'Fasi di lavoro',
  voci: 'Voci del preventivo',
  tabella: 'Tabella',
  riepilogo: 'Riepilogo totali',
  condizioni: 'Condizioni',
  nota: 'Nota',
  firma: 'Firme',
};

/* ── util ── */
let toastTimer = null;
function toast(msg, errore) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('errore', !!errore);
  t.classList.add('visibile');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visibile'), 3600);
}

async function apiJson(url, opzioni) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...(opzioni || {}) });
  const dati = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dati.errore || 'Errore inatteso');
  return dati;
}

function chiudiModali() {
  document.querySelectorAll('.modale').forEach((m) => m.classList.remove('aperta'));
  $('velo').classList.remove('attivo');
  $('drawer').classList.remove('aperto');
}

/* ── avvio ── */
(async () => {
  try {
    const stato = await apiJson('/api/stato');
    $('modello-label').textContent = `motore ${stato.modello} · ${stato.aiPronta ? 'AI pronta' : 'AI non configurata'}`;
    if (!stato.aiPronta) {
      toast('Chiave OpenRouter non configurata: salva le Impostazioni o controlla le variabili d\'ambiente', true);
    }
  } catch {
    $('modello-label').textContent = 'motore non raggiungibile';
  }
  ridimensionaAnteprima();
})();

window.addEventListener('resize', ridimensionaAnteprima);

/* ═══════════════ chat ═══════════════ */

const SUGGERIMENTI = [
  ['Bagno completo', 'Preventivo ristrutturazione completa bagno: demolizioni, impianto idraulico, piastrelle 60x60, sanitari con box doccia, verniciatura. Cliente: Rossi Domenico, Via Verdi 4, Brescia. Budget attorno ai 6000 euro.'],
  ['Impianto termico (IVA 10%)', 'Preventivo per il signor Marco Lo Verde, via Oropa 78, Torino: sostituzione scaldabagno a gas con Vaillant Turbo 14-16 l/min, fornitura 1436 euro IVA esclusa, installazione e collaudo incluse, smaltimento incluso, manutenzione annua 50 euro. IVA agevolata 10% su immobile abitativo.'],
  ['Manutenzione mensile', 'Contratto di manutenzione programmata mensile per un bagno aziendale e aree comuni: pulizie periodiche, controllo impianti, rifornimenti. Cliente: EDU DAF S.r.l., Via di Pietralata 165, Roma. Tariffa mensile fissa.'],
];

SUGGERIMENTI.forEach(([etichetta, testo]) => {
  const c = document.createElement('button');
  c.className = 'chip';
  c.type = 'button';
  c.textContent = etichetta;
  c.addEventListener('click', () => {
    $('msg').value = testo;
    $('msg').focus();
  });
  $('msg').insertAdjacentElement('afterend', c);
});
document.querySelector('.composer').insertAdjacentHTML('afterbegin', '<div class="composer-chips"></div>');
document.querySelectorAll('.composer > .chip').forEach((c) => document.querySelector('.composer-chips').appendChild(c));

function addMsg(ruolo, testo, benvenuto) {
  const d = document.createElement('div');
  d.className = `chat-msg ${ruolo}${benvenuto ? ' benvenuto' : ''}`;
  const b = document.createElement('div');
  b.className = 'bubble';
  b.innerHTML = testo;
  d.appendChild(b);
  $('chat-msgs').appendChild(d);
  $('chat-msgs').scrollTop = $('chat-msgs').scrollHeight;
  return d;
}

function addMsgAttesa() {
  const d = document.createElement('div');
  d.className = 'chat-msg agente attesa';
  d.innerHTML = '<div class="bubble"><span class="spin scuro"></span> <span class="testo">Sto componendo il documento…</span></div>';
  $('chat-msgs').appendChild(d);
  $('chat-msgs').scrollTop = $('chat-msgs').scrollHeight;
  return d;
}

const FASI_ATTESA = [
  'Sto componendo il documento…',
  'Calcolo prezzi e totali…',
  'Aggiusto la struttura dei blocchi…',
  'Ultimando i dettagli…',
];

async function inviaMessaggio() {
  const testo = $('msg').value.trim();
  if (!testo) return;
  if (state.lavoroInCorso) { toast('Un turno è già in corso: attendi la risposta', true); return; }
  if (!state.documento && state.messaggi.length >= 6) {
    toast('Documenti molto lunghi in chat: meglio avviarne uno nuovo con "Nuovo"', true);
  }

  $('msg').value = '';
  state.messaggi.push({ ruolo: 'utente', testo });
  addMsg('utente', testo.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>'));
  state.lavoroInCorso = true;
  $('btn-invia').disabled = true;
  const attesa = addMsgAttesa();
  let fase = 0;
  const cicloFasi = setInterval(() => {
    fase = (fase + 1) % FASI_ATTESA.length;
    const t = attesa.querySelector('.testo');
    if (t) t.textContent = FASI_ATTESA[fase];
  }, 6000);

  try {
    const { jobId } = await apiJson('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ messaggi: state.messaggi, documento: state.documento }),
    });
    const esito = await attendiTurno(jobId);
    attesa.remove();
    clearInterval(cicloFasi);
    state.documento = esito.documento;
    state.messaggi.push({ ruolo: 'agente', testo: esito.nota });
    addMsg('agente', esito.nota.replace(/&/g, '&amp;').replace(/</g, '&lt;'));
    await renderDocumento();
  } catch (e) {
    attesa.remove();
    clearInterval(cicloFasi);
    addMsg('agente', `<span class="msg-errore">${String(e.message).replace(/</g, '&lt;')}</span>`);
    toast(e.message, true);
  } finally {
    state.lavoroInCorso = false;
    $('btn-invia').disabled = false;
    $('msg').focus();
  }
}

async function attendiTurno(jobId) {
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const j = await apiJson(`/api/chat/${jobId}`);
    if (j.stato === 'pronto') return j;
    if (j.stato === 'errore') throw new Error(j.errore || 'Turno fallito');
  }
  throw new Error('L\'AI sta mettendo troppo tempo: riprova');
}

$('btn-invia').addEventListener('click', inviaMessaggio);
$('msg').addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    inviaMessaggio();
  }
});

$('btn-nuovo').addEventListener('click', () => {
  if (state.lavoroInCorso) { toast('Attendi il turno in corso', true); return; }
  state.messaggi = [];
  state.documento = null;
  state.salvatoId = null;
  state.legacy = null;
  $('chat-msgs').querySelectorAll('.chat-msg:not(.benvenuto)').forEach((x) => x.remove());
  $('outline').innerHTML = '';
  $('preview').style.display = 'none';
  $('empty-doc').classList.remove('hidden');
  $('doc-totale').textContent = '';
  setTema('servizi');
  toast('Nuovo preventivo pronto per la chat');
});

/* ═══════════════ documento: anteprima + outline ═══════════════ */

async function renderDocumento() {
  if (!state.documento) return;
  const r = await apiJson('/api/render-doc', {
    method: 'POST',
    body: JSON.stringify({ documento: state.documento }),
  });
  state.documento = r.documento;
  setTema(state.documento.tema);
  $('empty-doc').classList.add('hidden');
  const frame = $('preview');
  frame.srcdoc = r.html;
  frame.style.display = 'block';
  frame.addEventListener('load', () => {
    try {
      const h = Math.max(1123, frame.contentDocument.body.scrollHeight + 40);
      frame.style.height = `${h}px`;
      ridimensionaAnteprima();
    } catch { /* iframe multipagina: altezza base */ }
  }, { once: true });
  $('doc-totale').textContent = `Imponibile € ${fmt(state.documento.imponibile)} · Totale € ${fmt(state.documento.totale)}`;
  disegnaOutline();
}

function fmt(v) {
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);
}

function ridimensionaAnteprima() {
  const frame = $('preview');
  if (frame.style.display === 'none') return;
  const larghezza = Math.max(360, ($('desk').clientWidth || 900) - 68);
  const scala = Math.min(1, larghezza / 794);
  frame.style.transform = `scale(${scala})`;
  const holder = frame.parentElement;
  holder.style.width = `${794 * scala}px`;
  holder.style.height = `${frame.getBoundingClientRect().height / (scala || 1) * scala}px`;
  holder.style.height = `${1123 * scala}px`;
}

function disegnaOutline() {
  const o = $('outline');
  o.innerHTML = '';
  if (!state.documento || state.legacy) return;
  state.documento.blocchi.forEach((b, i) => {
    const c = document.createElement('div');
    c.className = 'outline-chip';
    c.title = 'Clic per modificare · ✕ per eliminare';
    c.innerHTML = `<span class="n">${i + 1}</span> ${ETICHETTE_TIPO[b.tipo] || b.tipo}${b.tipo === 'titolo' && b.testo ? `: <b>${b.testo.replace(/</g, '&lt;').slice(0, 30)}</b>` : ''}<button class="x" type="button" aria-label="Elimina">✕</button>`;
    c.addEventListener('click', (e) => {
      if (e.target.classList.contains('x')) return;
      apriModaleBlocco(i);
    });
    c.querySelector('.x').addEventListener('click', () => {
      state.documento.blocchi.splice(i, 1);
      renderDocumento();
      toast('Blocco eliminato');
    });
    o.appendChild(c);
  });
  const add = document.createElement('button');
  add.className = 'outline-add';
  add.type = 'button';
  add.textContent = '＋ Aggiungi blocco';
  add.addEventListener('click', () => apriModaleBlocco(null));
  o.appendChild(add);
}

/* ═══════════════ tema ═══════════════ */

function setTema(tema) {
  document.querySelectorAll('#seg-tema .seg-btn').forEach((b) => {
    b.classList.toggle('attivo', b.dataset.tema === tema);
  });
}
$('seg-tema').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b || state.legacy) return;
  if (!state.documento) {
    toast('Avvia prima la chat: il tema lo decidi nel primo messaggio o qui dopo', true);
    return;
  }
  if (state.documento.tema === b.dataset.tema) return;
  state.documento.tema = b.dataset.tema;
  renderDocumento();
});

/* ═══════════════ modale blocco ═══════════════ */

const ETICHETTE_CAMPO = {
  titolo: 'Titolo',
  sottotesto: 'Sottotitolo (facoltativo)',
  testo: 'Testo',
  items: 'Elementi (uno per riga)',
  etichetta: 'Etichetta',
  quantita: 'Quantità',
  prezzo: 'Importo € (vuoto = incluso)',
  intestazioni: 'Intestazioni (separate da virgola)',
  righe: 'Righe: celle separate da | (una riga per riga)',
  etichettaImponibile: 'Etichetta imponibile',
  etichettaTotale: 'Etichetta totale',
  'rate.testo': 'Rate: testo (es. "Pagamento in 3 rate da")',
  'rate.importoTesto': 'Rate: importo (es. "euro 350,00 + IVA")',
  emittenteNome: 'Firma emittente: nome',
  emittenteRuolo: 'Firma emittente: ruolo',
  clienteNome: 'Firma cliente: nome',
};

function campo(label, nome, valore, tipo) {
  const id = `f-${nome.replace(/\./g, '-')}`;
  const v = valore == null ? '' : String(valore);
  const controllo = tipo === 'textarea'
    ? `<textarea id="${id}" rows="4">${v.replace(/</g, '&lt;')}</textarea>`
    : `<input type="text" id="${id}" value="${v.replace(/"/g, '&quot;').replace(/</g, '&lt;')}">`;
  return `<label>${label}${controllo}</label>`;
}

function leggeCampo(nome) {
  const id = `f-${nome.replace(/\./g, '-')}`;
  return $(id) ? $(id).value : '';
}

function costruisciCampiBlocco(tipo, blocco) {
  const b = blocco || {};
  let html = '';
  if (tipo === 'titolo') {
    html += campo(ETICHETTE_CAMPO.titolo, 'titolo', b.testo || '');
    html += campo(ETICHETTE_CAMPO.sottotesto, 'sottotesto', b.sottotesto || '');
  } else if (tipo === 'testo' || tipo === 'nota') {
    html += campo(ETICHETTE_CAMPO.testo, 'testo', b.testo || '', 'textarea');
  } else if (tipo === 'elenco' || tipo === 'fasi') {
    html += campo(ETICHETTE_CAMPO.items, 'items', (b.items || []).join('\n'), 'textarea');
  } else if (tipo === 'voci') {
    html += '<div id="voci-blocco"></div><button class="btn small" id="btn-add-voce-blocco" type="button">+ Aggiungi voce</button>';
  } else if (tipo === 'tabella') {
    html += campo(ETICHETTE_CAMPO.intestazioni, 'intestazioni', (b.intestazioni || []).join(', '));
    html += campo(ETICHETTE_CAMPO.righe, 'righe', (b.righe || []).map((r) => r.join(' | ')).join('\n'), 'textarea');
  } else if (tipo === 'riepilogo') {
    html += campo(ETICHETTE_CAMPO.etichettaImponibile, 'etichettaImponibile', b.etichettaImponibile || 'Imponibile');
    html += campo(ETICHETTE_CAMPO.etichettaTotale, 'etichettaTotale', b.etichettaTotale || 'Totale IVA inclusa');
    html += campo(ETICHETTE_CAMPO['rate.testo'], 'rate.testo', (b.rate && b.rate.testo) || '');
    html += campo(ETICHETTE_CAMPO['rate.importoTesto'], 'rate.importoTesto', (b.rate && b.rate.importoTesto) || '');
  } else if (tipo === 'condizioni') {
    html += campo(ETICHETTE_CAMPO.etichetta, 'etichetta', b.etichetta || 'Condizioni');
    html += campo(ETICHETTE_CAMPO.items, 'items', (b.items || []).join('\n'), 'textarea');
  } else if (tipo === 'firma') {
    html += campo(ETICHETTE_CAMPO.emittenteNome, 'emittenteNome', b.emittenteNome || '');
    html += campo(ETICHETTE_CAMPO.emittenteRuolo, 'emittenteRuolo', b.emittenteRuolo || '');
    html += campo(ETICHETTE_CAMPO.clienteNome, 'clienteNome', b.clienteNome || '');
  }
  return html;
}

function disegnaVociBlocco(items) {
  const box = $('voci-blocco');
  box.innerHTML = '';
  (items || []).forEach((v) => {
    const riga = document.createElement('div');
    riga.className = 'voce';
    const prezzo = v.prezzo == null ? '' : String(v.prezzo);
    riga.innerHTML = `
      <div class="voce-head"><span class="voce-n">VOCE</span><button class="voce-del" type="button">Elimina</button></div>
      <label>Titolo<input type="text" class="v-t" value="${(v.titolo || '').replace(/"/g, '&quot;')}"></label>
      <label>Descrizione<input type="text" class="v-d" value="${(v.descrizione || '').replace(/"/g, '&quot;')}"></label>
      <div class="grid-3">
        <label>Qtà<input type="number" class="v-q" min="0" step="0.5" value="${v.quantita == null ? 1 : v.quantita}"></label>
        <label>Importo € (vuoto = incluso)<input type="number" class="v-p" min="0" step="0.01" value="${prezzo}"></label>
      </div>`;
    riga.querySelector('.voce-del').addEventListener('click', () => riga.remove());
    box.appendChild(riga);
  });
}

function leggiVociBlocco() {
  return [...document.querySelectorAll('#voci-blocco .voce')].map((riga) => ({
    titolo: riga.querySelector('.v-t').value.trim() || 'Voce',
    descrizione: riga.querySelector('.v-d').value.trim(),
    quantita: Number(riga.querySelector('.v-q').value) || 1,
    prezzo: riga.querySelector('.v-p').value === '' ? null : Number(riga.querySelector('.v-p').value),
  }));
}

let bloccoIndice = null; // null = nuovo blocco

function apriModaleBlocco(indice) {
  bloccoIndice = indice;
  const esistente = indice !== null ? state.documento.blocchi[indice] : null;
  $('blocco-titolo').textContent = esistente ? `Blocco ${indice + 1} · ${ETICHETTE_TIPO[esistente.tipo]}` : 'Aggiungi blocco';
  $('blocco-tipo-scelta').innerHTML = esistente ? '' : `
    <label>Tipo di blocco<select id="f-tipo">${Object.entries(ETICHETTE_TIPO)
      .map(([k, v]) => `<option value="${k}"${k === 'testo' ? ' selected' : ''}>${v}</option>`).join('')}</select></label>`;
  $('blocco-fields').innerHTML = costruisciCampiBlocco(esistente ? esistente.tipo : 'testo', esistente);
  if (esistente && esistente.tipo === 'voci') disegnaVociBlocco(esistente.items);
  const sel = $('f-tipo');
  if (sel) {
    sel.addEventListener('change', () => {
      $('blocco-fields').innerHTML = costruisciCampiBlocco(sel.value, null);
      if (sel.value === 'voci') disegnaVociBlocco([{ titolo: '', quantita: 1, prezzo: null }]);
    });
  }
  $('btn-add-voce-blocco')?.addEventListener('click', () => {
    disegnaVociBlocco([...leggiVociBlocco(), { titolo: '', quantita: 1, prezzo: null }]);
  });
  $('btn-blocco-su').disabled = bloccoIndice === null || bloccoIndice === 0;
  $('btn-blocco-giu').disabled = bloccoIndice === null || bloccoIndice === state.documento.blocchi.length - 1;
  $('btn-blocco-elimina').disabled = bloccoIndice === null;
  $('modale-blocco').classList.add('aperta');
  $('velo').classList.add('attivo');
}

function chiudiModaleBlocco() {
  $('modale-blocco').classList.remove('aperta');
  $('velo').classList.remove('attivo');
}

function leggiBlocco() {
  const tipo = ($('f-tipo') ? $('f-tipo').value : state.documento.blocchi[bloccoIndice].tipo);
  switch (tipo) {
    case 'titolo':
      return { tipo, testo: leggeCampo('titolo'), sottotesto: leggeCampo('sottotesto') };
    case 'testo':
    case 'nota':
      return { tipo, testo: leggeCampo('testo') };
    case 'elenco':
    case 'fasi':
      return { tipo, items: leggeCampo('items').split('\n').map((x) => x.trim()).filter(Boolean) };
    case 'voci':
      return { tipo, items: leggiVociBlocco() };
    case 'tabella':
      return {
        tipo,
        intestazioni: leggeCampo('intestazioni').split(',').map((x) => x.trim()).filter(Boolean),
        righe: leggeCampo('righe').split('\n').map((r) => r.split('|').map((c) => c.trim())).filter((r) => r.some(Boolean)),
      };
    case 'riepilogo': {
      const rate = leggeCampo('rate.testo')
        ? { testo: leggeCampo('rate.testo'), importoTesto: leggeCampo('rate.importoTesto') }
        : null;
      return {
        tipo,
        etichettaImponibile: leggeCampo('etichettaImponibile'),
        etichettaTotale: leggeCampo('etichettaTotale'),
        rate,
      };
    }
    case 'condizioni':
      return {
        tipo,
        etichetta: leggeCampo('etichetta'),
        items: leggeCampo('items').split('\n').map((x) => x.trim()).filter(Boolean),
      };
    case 'firma':
      return {
        tipo,
        emittenteNome: leggeCampo('emittenteNome'),
        emittenteRuolo: leggeCampo('emittenteRuolo'),
        clienteNome: leggeCampo('clienteNome'),
      };
    default:
      return null;
  }
}

$('btn-blocco-salva').addEventListener('click', () => {
  const blocco = leggiBlocco();
  if (!blocco) return;
  if (bloccoIndice === null) {
    state.documento.blocchi.push(blocco);
  } else {
    state.documento.blocchi[bloccoIndice] = blocco;
  }
  chiudiModaleBlocco();
  renderDocumento();
});

$('btn-blocco-annulla').addEventListener('click', chiudiModaleBlocco);
$('btn-blocco-elimina').addEventListener('click', () => {
  if (bloccoIndice === null) return;
  state.documento.blocchi.splice(bloccoIndice, 1);
  chiudiModaleBlocco();
  renderDocumento();
});
$('btn-blocco-su').addEventListener('click', () => {
  if (bloccoIndice === null || bloccoIndice === 0) return;
  const b = state.documento.blocchi;
  [b[bloccoIndice - 1], b[bloccoIndice]] = [b[bloccoIndice], b[bloccoIndice - 1]];
  chiudiModaleBlocco();
  renderDocumento();
});
$('btn-blocco-giu').addEventListener('click', () => {
  const b = state.documento.blocchi;
  if (bloccoIndice === null || bloccoIndice >= b.length - 1) return;
  [b[bloccoIndice + 1], b[bloccoIndice]] = [b[bloccoIndice], b[bloccoIndice + 1]];
  chiudiModaleBlocco();
  renderDocumento();
});

/* ═══════════════ modale dati documento ═══════════════ */

$('btn-dati').addEventListener('click', () => {
  if (!state.documento) { toast('Avvia prima la chat', true); return; }
  const d = state.documento;
  $('dati-fields').innerHTML = [
    campo('Oggetto', 'oggetto', d.oggetto),
    campo('Introduzione', 'intro', d.intro, 'textarea'),
    '<div class="grid-2">',
    campo('Cliente: nome', 'c-nome', d.cliente.nome),
    campo('Cliente: indirizzo', 'c-indirizzo', d.cliente.indirizzo),
    '</div>',
    '<div class="grid-2">',
    campo('Cliente: P.IVA', 'c-piva', d.cliente.piva),
    campo('Cliente: email', 'c-email', d.cliente.email),
    '</div>',
    '<div class="grid-2">',
    campo('Cliente: telefono', 'c-telefono', d.cliente.telefono),
    campo('Data (GG/MM/AAAA)', 'data', d.data),
    '</div>',
    '<div class="grid-2">',
    campo('Validità offerta', 'validita', d.validita),
    campo('Pagamento', 'pagamento', d.pagamento),
    '</div>',
    campo('IVA %', 'ivaPercent', d.ivaPercent),
  ].join('');
  $('modale-dati').classList.add('aperta');
  $('velo').classList.add('attivo');
});

$('btn-dati-annulla').addEventListener('click', chiudiModali);
$('btn-dati-salva').addEventListener('click', () => {
  const d = state.documento;
  d.oggetto = leggeCampo('oggetto') || d.oggetto;
  d.intro = leggeCampo('intro');
  d.cliente.nome = leggeCampo('c-nome');
  d.cliente.indirizzo = leggeCampo('c-indirizzo');
  d.cliente.piva = leggeCampo('c-piva');
  d.cliente.email = leggeCampo('c-email');
  d.cliente.telefono = leggeCampo('c-telefono');
  d.data = leggeCampo('data') || d.data;
  d.validita = leggeCampo('validita') || d.validita;
  d.pagamento = leggeCampo('pagamento') || d.pagamento;
  const iva = Number(leggeCampo('ivaPercent'));
  if (Number.isFinite(iva)) d.ivaPercent = iva;
  chiudiModali();
  renderDocumento();
  toast('Dati aggiornati');
});

/* ═══════════════ salva + pdf ═══════════════ */

$('btn-salva').addEventListener('click', async () => {
  if (!state.documento) { toast('Niente da salvare: avvia la chat', true); return; }
  if (state.legacy) { toast('Aperto in sola lettura: per modificarlo genera un nuovo preventivo in chat', true); return; }
  $('btn-salva').disabled = true;
  try {
    const r = await apiJson('/api/salva-doc', {
      method: 'POST',
      body: JSON.stringify({ documento: state.documento, chat: state.messaggi, id: state.salvatoId }),
    });
    state.salvatoId = r.id;
    state.documento = r.documento;
    disegnaOutline();
    toast(`Salvato in archivio${r.documento.numero ? ` (n. ${r.documento.numero})` : ''}`);
  } catch (e) {
    toast(e.message, true);
  } finally {
    $('btn-salva').disabled = false;
  }
});

$('btn-pdf').addEventListener('click', async () => {
  if (!state.documento && !state.legacy) { toast('Niente da esportare: avvia la chat', true); return; }
  $('btn-pdf').disabled = true;
  try {
    const endpoint = state.legacy ? '/api/pdf' : '/api/pdf-doc';
    const corpo = state.legacy ? { preventivo: state.legacy } : { documento: state.documento };
    const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    if (!r.ok) throw new Error('Generazione PDF non riuscita');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = state.legacy ? state.legacy.cliente.nome || 'preventivo' : state.documento.cliente.nome || 'preventivo';
    a.href = url;
    a.download = `Preventivo_${String(base).replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 30)}${state.documento && state.documento.numero ? `_${state.documento.numero}` : ''}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast(e.message, true);
  } finally {
    $('btn-pdf').disabled = false;
  }
});

/* ═══════════════ archivio ═══════════════ */

$('btn-archivio').addEventListener('click', async () => {
  chiudiModali();
  $('velo').classList.add('attivo');
  $('drawer').classList.add('aperto');
  await caricaArchivio();
});

$('btn-chiudi-drawer').addEventListener('click', chiudiModali);
$('velo').addEventListener('click', chiudiModali);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') chiudiModali();
});

async function caricaArchivio() {
  const lista = $('lista-preventivi');
  lista.innerHTML = '<div class="vuoto">Carico…</div>';
  try {
    const { preventivi: items } = await apiJson('/api/preventivi');
    if (!items.length) { lista.innerHTML = '<div class="vuoto">Nessun preventivo salvato</div>'; return; }
    lista.innerHTML = '';
    items.sort((a, b) => (b.data || 0) - (a.data || 0)).forEach((it) => {
      const q = it.quote || {};
      const viaChat = q.via === 'chat';
      const div = document.createElement('div');
      div.className = 'item-prev';
      div.innerHTML = `
        <div>
          <div class="t">${q.numero ? `N. ${q.numero}` : 'Senza numero'} ${viaChat ? '<span class="badge-chat">chat</span>' : ''}</div>
          <div class="s">${(q.oggetto || q.cliente?.nome || '').slice(0, 60)} · € ${fmt(q.totale)}</div>
        </div>
        <div class="azioni">
          <button class="btn small" data-az="apri">Apri</button>
          <button class="btn small ghost rosso" data-az="del">✕</button>
        </div>`;
      div.querySelector('[data-az="apri"]').addEventListener('click', () => apriArchivio(it));
      div.querySelector('[data-az="del"]').addEventListener('click', async () => {
        if (!confirm('Eliminare questo preventivo dall\'archivio?')) return;
        try {
          await apiJson(`/api/preventivi/${it.id}`, { method: 'DELETE' });
          await caricaArchivio();
          toast('Eliminato');
        } catch (e) {
          toast(e.message, true);
        }
      });
      lista.appendChild(div);
    });
  } catch (e) {
    lista.innerHTML = `<div class="vuoto">${e.message}</div>`;
  }
}

async function apriArchivio(item) {
  const q = item.quote || {};
  try {
    if (q.via === 'chat' && q.documento) {
      state.legacy = null;
      state.salvatoId = item.id;
      state.documento = q.documento;
      state.messaggi = Array.isArray(q.chat) ? q.chat.filter((m) => m && m.testo) : [];
      chiudiModali();
      ricostruisciChatDallArchivio(state.messaggi);
      await renderDocumento();
      toast(`Aperto ${q.numero ? `n. ${q.numero}` : ''}: continua a modificarlo in chat o esporta il PDF`);
    } else {
      const r = await apiJson('/api/render', { method: 'POST', body: JSON.stringify({ preventivo: q }) });
      const legato = r.preventivo;
      state.legacy = legato;
      state.documento = null;
      state.salvatoId = null;
      chiudiModali();
      setTema(legato.template || 'servizi');
      $('empty-doc').classList.add('hidden');
      $('outline').innerHTML = '';
      const frame = $('preview');
      frame.srcdoc = r.html;
      frame.style.display = 'block';
      frame.style.height = '1123px';
      ridimensionaAnteprima();
      $('doc-totale').textContent = `Imponibile € ${fmt(legato.imponibile)} · Totale € ${fmt(legato.totale)}`;
      toast('Creato col vecchio generatore: anteprima e PDF; per modificarlo avvia una nuova chat');
    }
  } catch (e) {
    toast(e.message, true);
  }
}

function ricostruisciChatDallArchivio(messaggi) {
  $('chat-msgs').querySelectorAll('.chat-msg:not(.benvenuto)').forEach((x) => x.remove());
  messaggi.forEach((m) => addMsg(m.ruolo, String(m.testo).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')));
}

/* ═══════════════ impostazioni ═══════════════ */

$('btn-impostazioni').addEventListener('click', async () => {
  chiudiModali();
  const dati = await apiJson('/api/stato');
  const imp = dati.impostazioni || {};
  const e = imp.emittente || {};
  const c = imp.coordinateBancarie || {};
  $('imp-fields').innerHTML = [
    '<div class="hint">Servono per la testata del PDF e per le firme. Restano solo nel tuo database.</div>',
    '<div class="grid-2">',
    campo('Nome azienda', 'e-nome', e.nome),
    campo('Indirizzo', 'e-indirizzo', e.indirizzo),
    '</div>',
    '<div class="grid-2">',
    campo('P.IVA', 'e-piva', e.piva),
    campo('Sito web', 'e-sito', e.sito),
    '</div>',
    campo('Tagline (tema tecnico)', 'e-tagline', e.tagline),
    '<div class="grid-2">',
    campo('Coordinate bancarie: intestato a', 'c-intestatoA', c.intestatoA),
    campo('IBAN', 'c-iban', c.iban),
    '</div>',
  ].join('');
  $('modale-impostazioni').classList.add('aperta');
  $('velo').classList.add('attivo');
});

$('btn-imp-annulla').addEventListener('click', chiudiModali);
$('btn-imp-salva').addEventListener('click', async () => {
  try {
    await apiJson('/api/impostazioni', {
      method: 'POST',
      body: JSON.stringify({
        emittente: {
          nome: leggeCampo('e-nome'),
          indirizzo: leggeCampo('e-indirizzo'),
          piva: leggeCampo('e-piva'),
          sito: leggeCampo('e-sito'),
          tagline: leggeCampo('e-tagline'),
        },
        coordinateBancarie: {
          intestatoA: leggeCampo('c-intestatoA'),
          iban: leggeCampo('c-iban'),
        },
      }),
    });
    chiudiModali();
    toast('Impostazioni salvate');
  } catch (e) {
    toast(e.message, true);
  }
});

/* ═══════════════ logout ═══════════════ */

$('btn-logout').addEventListener('click', async () => {
  try { await fetch('/api/logout', { method: 'POST' }); } catch { /* ignora */ }
  window.location.replace('/login');
});
