'use strict';

/* ─────────────────────────────────────────────────────────────
   Preventivi AI — logica interfaccia
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

const ESEMPI = {
  tecnico: `Preventivo per il signor Marco Lo Verde, via Oropa 78, 10153 Torino (TO). Sostituzione dello scaldabagno a gas esistente con un nuovo scaldabagno a gas Vaillant Turbo da 14-16 litri al minuto: fornitura apparecchio 1436 euro IVA esclusa, installazione e collaudo inclusi, lavaggio impianto incluso, smaltimento apparecchio vecchio incluso, certificazione impianto D.M. 37/2008 e prima accensione incluse, più un intervento annuo di manutenzione ordinaria a 50 euro. Intervento a domicilio, pagamento con bonifico bancario. Prezzi con IVA agevolata al 10% per intervento su immobile a uso abitativo.`,
  servizi: `Preventivo annuale di servizi digitali per EDU DAF S.r.l., Via di Pietralata 159/A, 00158 Roma, P.IVA 15923401002, codice destinatario SZLUBAI. Include: gestione completa dei social (editoriale, grafiche, pubblicazioni, community), gestione campagne pubblicitarie online con reportistica, modifiche e manutenzione del sito internet, gestione server incluso nell'offerta e sicurezza con backup e ripristino. Canone annuo 2250 euro più IVA, pagamento in 3 rate da 750 euro ciascuna. Budget pubblicitario e licenze terze parti esclusi.`,
};

const state = { preventivo: null, salvatoId: null };
let previewTimer = null;

/* ── utilitá ── */

function toast(msg, errore = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('errore', errore);
  el.classList.add('visibile');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visibile'), 3800);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function setSeg(container, valore) {
  container.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('attivo', b.dataset.template === valore));
}

/* ── stato iniziale ── */

async function caricaStato() {
  try {
    const r = await fetch('/api/stato');
    const d = await r.json();
    $('modello-label').textContent = d.aiPronta ? `Modello: ${d.modello}` : 'Chiave OpenRouter mancante — vedi .env';
    if (!d.aiPronta) toast('Chiave OpenRouter non configurata: crea il file .env', true);
    compilaImpostazioni(d.impostazioni);
  } catch { /* il server non risponde: la pagina stessa non sarebbe caricata */ }
}

/* ── generazione (job asincrono: POST → jobId → poll) ── */

const PASSI_AI = [
  'Lettura della richiesta.',
  'Scelta del layout e strutturazione delle voci.',
  'Stima dei prezzi e calcolo dei totali.',
  'Composizione del documento.',
];

async function genera() {
  const descrizione = $('descrizione').value.trim();
  if (descrizione.length < 10) {
    toast('Scrivi prima una descrizione del lavoro.', true);
    return;
  }
  const btn = $('btn-genera');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> L\'AI sta preparando il preventivo…';
  $('stato-ai').textContent = PASSI_AI[0];
  try {
    const template = document.querySelector('#seg-template .seg-btn.attivo').dataset.template;
    const r0 = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ descrizione, template }),
    });
    const d0 = await r0.json();
    if (!r0.ok) throw new Error(d0.errore || 'Errore di generazione');

    // poll del job: l'AI dura 2-4 minuti, mostriamo un passo ogni tanto
    const t0 = Date.now();
    const d = await new Promise((risolvi, rifiuta) => {
      const poll = async () => {
        try {
          const r = await fetch(`/api/generate/${d0.jobId}`);
          const j = await r.json();
          if (!r.ok) throw new Error(j.errore || 'Generazione non trovata');
          if (j.stato === 'pronto') return risolvi(j);
          if (j.stato === 'errore') throw new Error(j.errore || 'Errore di generazione');
          $('stato-ai').textContent = PASSI_AI[Math.min(Math.floor((Date.now() - t0) / 45000), PASSI_AI.length - 1)];
          setTimeout(poll, 2500);
        } catch (e) { rifiuta(e); }
      };
      poll();
    });

    state.preventivo = d.preventivo;
    state.salvatoId = null;
    $('stato-ai').textContent = '';
    $('stato-ai').classList.add('ok');
    mostraEditor();
  } catch (e) {
    $('stato-ai').textContent = e.message;
    $('stato-ai').classList.remove('ok');
    toast(e.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2.5l1.9 5.4 5.6 1.9-5.6 1.9L12 17.1l-1.9-5.4-5.6-1.9 5.6-1.9L12 2.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M18.5 15.5l.9 2.4 2.6.9-2.6.9-.9 2.4-.9-2.4-2.6-.9 2.6-.9.9-2.4Z" fill="currentColor"/></svg> Genera con l\'AI';
  }
}

/* ── editor ── */

function mostraEditor() {
  $('card-editor').classList.remove('hidden');
  compilaEditor();
  document.body.dataset.template = state.preventivo.template;
  setSeg($('seg-template-2'), state.preventivo.template);
  aggiornaPreview(true);
  $('card-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function compilaEditor() {
  const q = state.preventivo;
  $('ed-numero').textContent = q.numero ? `n. ${q.numero}` : '';
  const v = (id, val) => { $(id).value = val == null ? '' : val; };
  v('f-numero', q.numero);
  v('f-data', q.data);
  v('f-oggetto', q.oggetto);
  v('f-intro', q.intro);
  v('f-validita', q.validita);
  $('f-iva').value = q.ivaPercent;
  v('f-modalita', q.modalita);
  v('f-pagamento', q.pagamento);
  v('f-cliente-nome', q.cliente.nome);
  v('f-cliente-indirizzo', q.cliente.indirizzo);
  v('f-cliente-piva', q.cliente.piva);
  v('f-cliente-codice', q.cliente.codiceDestinatario);
  v('f-cliente-email', q.cliente.email);
  v('f-cliente-telefono', q.cliente.telefono);
  v('f-imponibile-label', q.imponibileLabel);
  v('f-totale-label', q.totaleLabel);
  v('f-rate-testo', q.rate ? q.rate.testo : '');
  v('f-rate-importo', q.rate ? q.rate.importoTesto : '');
  v('f-iban-intestato', q.coordinateBancarie.intestatoA);
  v('f-iban', q.coordinateBancarie.iban);
  v('f-condizioni', (q.condizioni || []).join('\n'));
  v('f-note', q.note);
  v('f-firma-emittente', q.firma.emittenteNome);
  v('f-firma-ruolo', q.firma.emittenteRuolo);
  v('f-firma-cliente', q.firma.clienteNome);
  renderVoci();
}

function renderVoci() {
  const cont = $('voci-editor');
  cont.innerHTML = '';
  (state.preventivo.voci || []).forEach((voce, i) => {
    const div = document.createElement('div');
    div.className = 'voce';
    div.innerHTML = `
      <div class="voce-head">
        <span class="voce-n">VOCE ${i + 1}</span>
        <button class="voce-del" type="button" title="Elimina voce">elimina</button>
      </div>
      <label>Titolo<input class="v-titolo" type="text" value="${esc(voce.titolo)}"></label>
      <label>Descrizione<input class="v-desc" type="text" value="${esc(voce.descrizione)}"></label>
      <div class="grid-3">
        <label>Q.tà<input class="v-qt" type="number" min="0" step="1" value="${voce.quantita}"></label>
        <label>Prezzo € IVA escl.<input class="v-prezzo" type="number" min="0" step="0.01" value="${voce.prezzo == null ? '' : voce.prezzo}" ${voce.prezzo == null ? 'disabled' : ''}></label>
        <label class="check-incluso"><input class="v-incluso" type="checkbox" ${voce.prezzo == null ? 'checked' : ''}> Incluso</label>
      </div>`;
    div.querySelector('.voce-del').addEventListener('click', () => {
      state.preventivo.voci.splice(i, 1);
      renderVoci();
      aggiornaPreview();
    });
    div.querySelector('.v-titolo').addEventListener('input', (e) => { state.preventivo.voci[i].titolo = e.target.value; aggiornaPreview(); });
    div.querySelector('.v-desc').addEventListener('input', (e) => { state.preventivo.voci[i].descrizione = e.target.value; aggiornaPreview(); });
    div.querySelector('.v-qt').addEventListener('input', (e) => { state.preventivo.voci[i].quantita = Number(e.target.value) || 1; aggiornaPreview(); });
    div.querySelector('.v-prezzo').addEventListener('input', (e) => {
      const n = Number(e.target.value);
      state.preventivo.voci[i].prezzo = Number.isFinite(n) && e.target.value !== '' ? Math.round(n * 100) / 100 : null;
      aggiornaPreview();
    });
    div.querySelector('.v-incluso').addEventListener('change', (e) => {
      if (e.target.checked) {
        state.preventivo.voci[i].prezzo = null;
      } else {
        state.preventivo.voci[i].prezzo = state.preventivo.voci[i].prezzo == null ? 0 : state.preventivo.voci[i].prezzo;
        div.querySelector('.v-prezzo').disabled = false;
        div.querySelector('.v-prezzo').focus();
      }
      div.querySelector('.v-prezzo').disabled = e.target.checked;
      if (e.target.checked) div.querySelector('.v-prezzo').value = '';
      aggiornaPreview();
    });
    cont.appendChild(div);
  });
}

/* raccolta dei campi nell'oggetto state (il server ricalcola i totali) */
function raccogliCampi() {
  const q = state.preventivo;
  if (!q) return;
  q.numero = $('f-numero').value.trim();
  q.data = $('f-data').value.trim();
  q.oggetto = $('f-oggetto').value.trim();
  q.intro = $('f-intro').value.trim();
  q.validita = $('f-validita').value.trim();
  q.ivaPercent = Number($('f-iva').value);
  q.modalita = $('f-modalita').value.trim();
  q.pagamento = $('f-pagamento').value.trim();
  q.cliente = {
    nome: $('f-cliente-nome').value.trim(),
    indirizzo: $('f-cliente-indirizzo').value.trim(),
    piva: $('f-cliente-piva').value.trim(),
    codiceDestinatario: $('f-cliente-codice').value.trim(),
    email: $('f-cliente-email').value.trim(),
    telefono: $('f-cliente-telefono').value.trim(),
  };
  q.imponibileLabel = $('f-imponibile-label').value.trim();
  q.totaleLabel = $('f-totale-label').value.trim();
  const rt = $('f-rate-testo').value.trim();
  q.rate = rt ? { testo: rt, importoTesto: $('f-rate-importo').value.trim() } : null;
  q.coordinateBancarie = {
    intestatoA: $('f-iban-intestato').value.trim(),
    iban: $('f-iban').value.trim(),
  };
  q.condizioni = $('f-condizioni').value.split('\n').map((s) => s.trim()).filter(Boolean);
  q.note = $('f-note').value.trim();
  q.firma = {
    emittenteNome: $('f-firma-emittente').value.trim(),
    emittenteRuolo: $('f-firma-ruolo').value.trim(),
    clienteNome: $('f-firma-cliente').value.trim(),
  };
}

function aggiornaPreview(immediato = false) {
  raccogliCampi();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => renderPreview(), immediato ? 0 : 350);
}

async function renderPreview() {
  if (!state.preventivo) return;
  try {
    const r = await fetch('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preventivo: state.preventivo }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.errore || 'Errore di rendering');
    state.preventivo = d.preventivo;
    const iframe = $('preview');
    iframe.srcdoc = d.html;
    iframe.onload = () => {
      try {
        const h = iframe.contentDocument.documentElement.scrollHeight;
        iframe.style.height = `${Math.max(h, 1123)}px`;
      } catch { /* iframe non ancora pronto */ }
      adattaScala();
    };
    iframe.style.display = 'block';
    $('empty-state').classList.add('hidden');
  } catch (e) {
    toast(e.message, true);
  }
}

function adattaScala() {
  const iframe = $('preview');
  if (iframe.style.display === 'none') return;
  const desk = $('desk');
  const disponibile = desk.clientWidth - 68;
  const scala = Math.min(1, disponibile / 794);
  iframe.style.transform = `scale(${scala})`;
  $('sheet-holder').style.height = `${parseFloat(iframe.style.height || 1123) * scala}px`;
  $('sheet-holder').style.width = `${794 * scala}px`;
}
window.addEventListener('resize', adattaScala);

/* ── PDF ── */

async function scaricaPdf() {
  if (!state.preventivo) return;
  raccogliCampi();
  const btn = $('btn-pdf');
  btn.disabled = true;
  try {
    const r = await fetch('/api/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preventivo: state.preventivo }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.errore || 'Errore nella creazione del PDF');
    }
    const blob = await r.blob();
    const cd = r.headers.get('Content-Disposition') || '';
    const m = /filename="([^"]+)"/.exec(cd);
    const nome = m ? m[1] : 'preventivo.pdf';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    a.click();
    URL.revokeObjectURL(url);
    toast(`PDF scaricato: ${nome}`);
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

/* ── archivio ── */

async function apriArchivio() {
  $('velo').classList.add('attivo');
  $('drawer-archivio').classList.add('aperto');
  await ricaricaArchivio();
}

function chiudiArchivio() {
  $('velo').classList.remove('attivo');
  $('drawer-archivio').classList.remove('aperto');
}

async function ricaricaArchivio() {
  const cont = $('lista-preventivi');
  cont.innerHTML = '<div class="vuoto">Caricamento…</div>';
  const r = await fetch('/api/preventivi');
  const d = await r.json();
  const lista = d.preventivi || [];
  if (!lista.length) {
    cont.innerHTML = '<div class="vuoto">Nessun preventivo salvato.</div>';
    return;
  }
  cont.innerHTML = '';
  lista.forEach((p) => {
    const q = p.quote || {};
    const div = document.createElement('div');
    div.className = 'item-prev';
    div.innerHTML = `
      <div>
        <div class="t mono">${esc(q.numero || 'senza numero')}</div>
        <div class="s">${esc(q.cliente && q.cliente.nome || q.oggetto || '')}</div>
      </div>
      <div class="azioni">
        <button class="btn small" data-act="apri" type="button">Apri</button>
        <button class="btn small ghost" data-act="elimina" type="button">✕</button>
      </div>`;
    div.querySelector('[data-act="apri"]').addEventListener('click', async () => {
      const rr = await fetch(`/api/preventivi/${p.id}`);
      const dd = await rr.json();
      if (!rr.ok) return toast(dd.errore || 'Errore', true);
      state.preventivo = dd.preventivo;
      state.salvatoId = p.id;
      chiudiArchivio();
      mostraEditor();
    });
    div.querySelector('[data-act="elimina"]').addEventListener('click', async () => {
      await fetch(`/api/preventivi/${p.id}`, { method: 'DELETE' });
      ricaricaArchivio();
      toast('Preventivo eliminato.');
    });
    cont.appendChild(div);
  });
}

async function salva() {
  if (!state.preventivo) return;
  raccogliCampi();
  const body = { preventivo: state.preventivo };
  if (state.salvatoId) body.preventivo.id = state.salvatoId;
  const r = await fetch('/api/salva', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) return toast(d.errore || 'Errore di salvataggio', true);
  state.salvatoId = d.id;
  toast('Preventivo salvato in archivio.');
}

/* ── impostazioni ── */

function compilaImpostazioni(imp) {
  if (!imp) return;
  $('s-nome').value = (imp.emittente && imp.emittente.nome) || '';
  $('s-indirizzo').value = (imp.emittente && imp.emittente.indirizzo) || '';
  $('s-piva').value = (imp.emittente && imp.emittente.piva) || '';
  $('s-sito').value = (imp.emittente && imp.emittente.sito) || '';
  $('s-tagline').value = (imp.emittente && imp.emittente.tagline) || '';
  $('s-iban-intestato').value = (imp.coordinateBancarie && imp.coordinateBancarie.intestatoA) || '';
  $('s-iban').value = (imp.coordinateBancarie && imp.coordinateBancarie.iban) || '';
}

async function salvaImpostazioni() {
  const body = {
    emittente: {
      nome: $('s-nome').value.trim(),
      indirizzo: $('s-indirizzo').value.trim(),
      piva: $('s-piva').value.trim(),
      sito: $('s-sito').value.trim(),
      tagline: $('s-tagline').value.trim(),
    },
    coordinateBancarie: {
      intestatoA: $('s-iban-intestato').value.trim(),
      iban: $('s-iban').value.trim(),
    },
  };
  const r = await fetch('/api/impostazioni', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) return toast('Errore di salvataggio', true);
  $('modale-impostazioni').classList.remove('aperta');
  toast('Impostazioni salvate.');
}

/* ── event binding ── */

function bindEventi() {
  $('btn-genera').addEventListener('click', genera);
  $('btn-rigenera').addEventListener('click', genera);
  $('btn-nuovo').addEventListener('click', () => {
    state.preventivo = null;
    state.salvatoId = null;
    $('card-editor').classList.add('hidden');
    $('preview').style.display = 'none';
    $('empty-state').classList.remove('hidden');
    $('descrizione').value = '';
    $('descrizione').focus();
  });

  $('btn-pdf').addEventListener('click', scaricaPdf);
  $('btn-salva').addEventListener('click', salva);

  document.querySelectorAll('#seg-template .seg-btn').forEach((b) => {
    b.addEventListener('click', () => setSeg($('seg-template'), b.dataset.template));
  });
  document.querySelectorAll('#seg-template-2 .seg-btn').forEach((b) => {
    b.addEventListener('click', () => {
      setSeg($('seg-template-2'), b.dataset.template);
      if (state.preventivo) {
        state.preventivo.template = b.dataset.template;
        document.body.dataset.template = b.dataset.template;
        aggiornaPreview(true);
      }
    });
  });

  document.querySelectorAll('[data-esempio]').forEach((b) => {
    b.addEventListener('click', () => {
      $('descrizione').value = ESEMPI[b.dataset.esempio];
      $('descrizione').focus();
    });
  });

  document.querySelectorAll('#card-editor input, #card-editor textarea').forEach((el) => {
    el.addEventListener('input', () => aggiornaPreview());
  });
  $('btn-add-voce').addEventListener('click', () => {
    state.preventivo.voci.push({ titolo: '', descrizione: '', quantita: 1, prezzo: 0 });
    renderVoci();
    aggiornaPreview();
  });

  $('btn-archivio').addEventListener('click', apriArchivio);
  $('btn-chiudi-archivio').addEventListener('click', chiudiArchivio);
  $('velo').addEventListener('click', chiudiArchivio);

  $('btn-impostazioni').addEventListener('click', () => $('modale-impostazioni').classList.add('aperta'));
  $('btn-chiudi-impostazioni').addEventListener('click', () => $('modale-impostazioni').classList.remove('aperta'));
  $('btn-salva-impostazioni').addEventListener('click', salvaImpostazioni);

  $('btn-esci').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.replace('/login');
  });
}

caricaStato();
bindEventi();
