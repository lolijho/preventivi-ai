'use strict';

const store = require('./store');
const ai = require('./ai');

function s(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizzaData(dataRaw) {
  const d = s(dataRaw);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) return d;
  return ai.todayIt();
}

function parsePrezzo(vv) {
  if (vv == null) return null;
  if (typeof vv === 'number') return Number.isFinite(vv) ? Math.round(vv * 100) / 100 : null;
  let t = String(vv).replace(/[€\s]/g, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function normalizza(raw, sceltaTemplate, impostazioni) {
  const q = raw && typeof raw === 'object' ? raw : {};
  const template = sceltaTemplate && sceltaTemplate !== 'auto'
    ? sceltaTemplate
    : (q.template === 'servizi' || q.template === 'tecnico' ? q.template : 'servizi');

  const emittente = {
    nome: s(q.emittente && q.emittente.nome),
    indirizzo: s(q.emittente && q.emittente.indirizzo),
    piva: s(q.emittente && q.emittente.piva),
    sito: s(q.emittente && q.emittente.sito),
    tagline: s(q.emittente && q.emittente.tagline),
  };

  // se l'utente ha configurato l'emittente predefinito, ha priorita'
  const imp = impostazioni || {};
  if (imp.emittente && imp.emittente.nome) {
    emittente.nome = imp.emittente.nome;
    emittente.indirizzo = imp.emittente.indirizzo || emittente.indirizzo;
    emittente.piva = imp.emittente.piva || emittente.piva;
    emittente.sito = imp.emittente.sito || emittente.sito;
    emittente.tagline = imp.emittente.tagline || emittente.tagline;
  }

  const vociRaw = Array.isArray(q.voci) ? q.voci : [];
  const voci = vociRaw.map((v) => {
    const incluso = !v || v.incluso === true || v.prezzo == null;
    return {
      titolo: s(v && v.titolo) || 'Voce',
      descrizione: s(v && v.descrizione),
      quantita: Math.max(num(v && v.quantita, 1), 0) || 1,
      prezzo: incluso ? null : parsePrezzo(v.prezzo),
    };
  });

  const ivaPercent = Math.min(Math.max(num(q.ivaPercent, 22), 0), 100);
  const imponibile = voci.reduce((acc, v) => acc + (v.prezzo === null ? 0 : v.quantita * v.prezzo), 0);
  const imponibileArrotondato = Math.round(imponibile * 100) / 100;
  const ivaImporto = Math.round(imponibileArrotondato * ivaPercent) / 100;
  const totale = Math.round((imponibileArrotondato + ivaImporto) * 100) / 100;

  const coordinate = {
    intestatoA: s(q.coordinateBancarie && q.coordinateBancarie.intestatoA) || (imp.coordinateBancarie && imp.coordinateBancarie.intestatoA) || '',
    iban: s(q.coordinateBancarie && q.coordinateBancarie.iban) || (imp.coordinateBancarie && imp.coordinateBancarie.iban) || '',
  };

  const fasi = Array.isArray(q.fasi)
    ? q.fasi.map((f) => ({ titolo: typeof f === 'string' ? f : s(f && f.titolo) })).filter((f) => f.titolo)
    : [];

  return {
    template,
    emittente,
    cliente: {
      nome: s(q.cliente && q.cliente.nome),
      indirizzo: s(q.cliente && q.cliente.indirizzo),
      piva: s(q.cliente && q.cliente.piva),
      codiceDestinatario: s(q.cliente && q.cliente.codiceDestinatario),
      email: s(q.cliente && q.cliente.email),
      telefono: s(q.cliente && q.cliente.telefono),
    },
    numero: s(q.numero),
    data: normalizzaData(q.data),
    validita: s(q.validita) || '30 giorni',
    oggetto: s(q.oggetto) || 'Fornitura di servizi',
    intro: s(q.intro),
    modalita: s(q.modalita),
    fasi,
    imponibileLabel: s(q.imponibileLabel),
    totaleLabel: s(q.totaleLabel),
    voci,
    ivaPercent,
    imponibile: imponibileArrotondato,
    ivaImporto,
    totale,
    rate: q.rate && s(q.rate.testo)
      ? { testo: s(q.rate.testo), importoTesto: s(q.rate.importoTesto) }
      : null,
    pagamento: s(q.pagamento) || 'Bonifico bancario',
    coordinateBancarie: coordinate,
    condizioni: Array.isArray(q.condizioni) ? q.condizioni.map(s).filter(Boolean) : [],
    note: s(q.note),
    firma: {
      emittenteNome: s(q.firma && q.firma.emittenteNome) || emittente.nome,
      emittenteRuolo: s(q.firma && q.firma.emittenteRuolo) || 'L\'Amministratore',
      clienteNome: s(q.firma && q.firma.clienteNome),
    },
  };
}

async function completaNumero(quote) {
  if (quote.numero) return quote;
  return { ...quote, numero: await store.nextNumero(quote.template) };
}

/* formattatori */
function fmtEuro(v) {
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(v);
}

function dataLunga(dataIt) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dataIt);
  if (!m) return dataIt;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return store.dataLungaIt(d);
}

module.exports = { normalizza, completaNumero, fmtEuro, dataLunga };
