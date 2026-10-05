'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { fmtEuro, dataLunga } = require('./quote');

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function line(v) {
  const t = String(v == null ? '' : v).trim();
  return t ? `<div>${esc(t)}</div>` : '';
}

function wordmark(nome) {
  return String(nome || 'Azienda').replace(/\s*(S\.?r\.?l\.?|S\.?p\.?A\.?|S\.?N\.?C\.?|S\.?A\.?S\.?|srl|spa|snc|sas)\.?$/i, '').trim() || nome || 'Azienda';
}

/* ---------- corpo template SERVIZI ---------- */

function buildServiziBody(q) {
  const cl = q.cliente;
  const destLines = [
    line(cl.nome),
    line(cl.indirizzo),
    cl.piva ? `<div>P.IVA ${esc(cl.piva)}</div>` : '',
    cl.codiceDestinatario ? `<div>Cod. Destinatario ${esc(cl.codiceDestinatario)}</div>` : '',
    line(cl.email),
    line(cl.telefono),
  ].join('');

  const vociRows = q.voci.map((v, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>
          <div class="sv-tit">${esc(v.titolo)}</div>
          ${v.descrizione ? `<div class="sv-desc">${esc(v.descrizione)}</div>` : ''}
        </td>
      </tr>`).join('');

  const tabella = q.voci.length ? `
    <table class="sv">
      <thead>
        <tr><th class="num">#</th><th>Servizi inclusi</th></tr>
      </thead>
      <tbody>${vociRows}
      </tbody>
    </table>` : '';

  const rate = q.rate ? `
    <div class="trow rate"><span class="lbl">${esc(q.rate.testo)}</span><span class="val">${esc(q.rate.importoTesto)}</span></div>` : '';

  const totali = `
    <div class="sv-totals">
      <div class="trow mid"><span class="lbl">${esc(q.imponibileLabel || 'Imponibile')}</span><span class="val">&euro; ${fmtEuro(q.imponibile)}</span></div>
      <div class="trow mid"><span class="lbl">IVA ${fmtEuro(q.ivaPercent).replace(',00', '')}%</span><span class="val">&euro; ${fmtEuro(q.ivaImporto)}</span></div>
      <div class="trow tot"><span class="lbl">${esc(q.totaleLabel || 'Totale IVA inclusa')}</span><span class="val">&euro; ${fmtEuro(q.totale)}</span></div>${rate}
    </div>`;

  const condizioni = q.condizioni.length ? `
    <div class="cond-label">CONDIZIONI</div>
    <ul class="cond">
      ${q.condizioni.map((c) => `<li>${esc(c)}</li>`).join('\n      ')}
    </ul>` : '';

  const nota = q.note ? `\n    <div class="nota">${esc(q.note)}</div>` : '';

  const firme = `
    <div class="sig-row">
      <div class="sig">
        <div class="sig-a">${esc(q.firma.emittenteNome || q.emittente.nome)}</div>
        ${q.firma.emittenteRuolo ? `<div class="sig-b">${esc(q.firma.emittenteRuolo)}</div>` : ''}
        <div class="sig-line"></div>
      </div>
      <div class="sig">
        <div class="sig-a">Per accettazione</div>
        ${q.firma.clienteNome || cl.nome ? `<div class="sig-b">${esc(q.firma.clienteNome || cl.nome)}</div>` : '<div class="sig-b">&nbsp;</div>'}
        <div class="sig-line"></div>
      </div>
    </div>`;

  return `
    <div class="cols">
      <div>
        <div class="col-label">DESTINATARIO</div>
        ${destLines}
      </div>
      <div>
        <div class="col-label">PREVENTIVO</div>
        <div class="pv-num">N. <b>${esc(q.numero)}</b></div>
        <div class="pv-meta">
          <div>Data: ${esc(q.data)}</div>
          <div>Validit&agrave;: ${esc(q.validita)}</div>
        </div>
      </div>
    </div>
    <div class="oggetto">Oggetto: ${esc(q.oggetto)}</div>
    ${q.intro ? `<div class="intro">${esc(q.intro)}</div>` : ''}${tabella}${totali}${condizioni}${nota}${firme}
  `;
}

/* ---------- corpo template TECNICO ---------- */

function buildTecnicoBody(q) {
  const cl = q.cliente;

  const boxDettagli = `
      <div class="box">
        <div class="box-head">DETTAGLI PREVENTIVO</div>
        <div class="box-body">
          <div class="brow"><div class="blbl">NUMERO</div><div class="bval">${esc(q.numero)}</div></div>
          <div class="brow"><div class="blbl">DATA EMISSIONE</div><div class="bval">${esc(dataLunga(q.data))}</div></div>
          ${q.modalita ? `<div class="brow"><div class="blbl">MODALIT&Agrave;</div><div class="bval">${esc(q.modalita)}</div></div>` : ''}
          <div class="brow"><div class="blbl">PAGAMENTO</div><div class="bval">${esc(q.pagamento)}</div></div>
        </div>
      </div>`;

  const boxCliente = `
      <div class="box">
        <div class="box-head">DATI CLIENTE</div>
        <div class="box-body">
          <div class="brow"><div class="blbl">INTESTATARIO</div><div class="bval">${esc(cl.nome) || '&mdash;'}</div></div>
          ${cl.indirizzo ? `<div class="brow"><div class="blbl">INDIRIZZO</div><div class="bval">${esc(cl.indirizzo)}</div></div>` : ''}
          ${cl.piva ? `<div class="brow"><div class="blbl">P.IVA</div><div class="bval">${esc(cl.piva)}</div></div>` : ''}
          <div class="brow"><div class="blbl">OGGETTO</div><div class="bval">${esc(q.oggetto)}</div></div>
        </div>
      </div>`;

  const fasi = (q.fasi && q.fasi.length ? q.fasi : q.voci.map((v) => ({ titolo: v.titolo })))
    .filter((f) => f && f.titolo);
  const fasiTable = fasi.length ? `
    <div class="sec-title">FASI DELLA LAVORAZIONE</div>
    <table class="tb">
      <thead><tr><th class="w-fase c">FASE</th><th>ATTIVIT&Agrave;</th></tr></thead>
      <tbody>
        ${fasi.map((f, i) => `
        <tr>
          <td class="fase-num">${String(i + 1).padStart(2, '0')}</td>
          <td><div class="v-tit">${esc(f.titolo)}</div></td>
        </tr>`).join('')}
      </tbody>
    </table>` : '';

  const vociRows = q.voci.map((v) => `
        <tr>
          <td>
            <div class="v-tit">${esc(v.titolo)}</div>
            ${v.descrizione ? `<div class="v-desc">${esc(v.descrizione)}</div>` : ''}
          </td>
          <td class="qt">${v.quantita}</td>
          <td class="imp">${v.prezzo === null ? 'Incluso' : `&euro; ${fmtEuro(v.prezzo)}`}</td>
        </tr>`).join('');

  const riepilogo = q.voci.length ? `
    <div class="sec-title">RIEPILOGO ECONOMICO</div>
    <table class="tb">
      <thead><tr><th>DESCRIZIONE</th><th class="w-qt c">Q.T&Agrave;</th><th class="w-importo r">IMPORTO</th></tr></thead>
      <tbody>${vociRows}
      </tbody>
    </table>` : '';

  const totali = `
    <div class="tc-totals">
      <div class="trow"><span class="lbl">Imponibile</span><span class="val">&euro; ${fmtEuro(q.imponibile)}</span></div>
      <div class="trow"><span class="lbl">IVA ${fmtEuro(q.ivaPercent).replace(',00', '')}%</span><span class="val">&euro; ${fmtEuro(q.ivaImporto)}</span></div>
      <div class="tot"><span class="lbl">TOTALE IVA INCLUSA</span><span class="val">&euro; ${fmtEuro(q.totale)}</span></div>
    </div>`;

  const cb = q.coordinateBancarie;
  const iban = (cb && (cb.intestatoA || cb.iban)) ? `
    <div class="iban-box">
      <div class="iban-title">COORDINATE BANCARIE PER IL PAGAMENTO</div>
      ${cb.intestatoA ? `<div class="iban-row"><div class="lbl">Intestato a:</div><div class="val">${esc(cb.intestatoA)}</div></div>` : ''}
      ${cb.iban ? `<div class="iban-row"><div class="lbl">IBAN:</div><div class="val">${esc(cb.iban)}</div></div>` : ''}
    </div>` : '';

  const condizioni = q.condizioni.length ? `
    <div class="sec-title">CONDIZIONI</div>
    <ul class="cond">
      ${q.condizioni.map((c) => `<li>${esc(c)}</li>`).join('\n      ')}
    </ul>` : '';

  const note = q.note ? `
    <div class="sec-title">NOTE</div>
    <div class="sec-par">${esc(q.note)}</div>` : '';

  return `
    <div class="pv-title">PREVENTIVO</div>
    <div class="pv-sub">Offerta economica per ${esc(q.oggetto.charAt(0).toLowerCase() + q.oggetto.slice(1))}</div>
    <div class="gold-bar"></div>
    <div class="boxes">${boxDettagli}${boxCliente}
    </div>
    <div class="sec-title first">OGGETTO DELL'INTERVENTO</div>
    <div class="sec-par">${esc(q.intro || q.oggetto)}</div>
    ${fasiTable}${riepilogo}${totali}${iban}${condizioni}${note}
    <div class="sec-title">PER ACCETTAZIONE</div>
    <div class="acc-row">
      <div class="acc-col"><div class="acc-line"></div><div class="acc-lbl">Data</div></div>
      <div class="acc-col"><div class="acc-line"></div><div class="acc-lbl">Firma del cliente</div></div>
    </div>
  `;
}

/* ---------- composizione pagina ---------- */

function bloccoOpzionale(html) {
  return html ? `${html}\n        ` : '';
}

function renderHTML(q) {
  const file = q.template === 'tecnico' ? 'tecnico.html' : 'servizi.html';
  const tpl = fs.readFileSync(path.join(config.templatesDir, file), 'utf8');
  const em = q.emittente;

  const sostituzioni = {
    '{{WORDMARK}}': esc(wordmark(em.nome)),
    '{{EM_NOME}}': esc(em.nome || 'Azienda'),
    '{{TAGLINE_HTML}}': bloccoOpzionale(em.tagline ? `<div class="tagline">${esc(em.tagline)}</div>` : ''),
    '{{EM_INDIRIZZO_HTML}}': bloccoOpzionale(line(em.indirizzo)),
    '{{EM_PIVA_HTML}}': bloccoOpzionale(em.piva ? `<div>P. IVA ${esc(em.piva)}</div>` : ''),
    '{{EM_SITO_HTML}}': bloccoOpzionale(line(em.sito)),
    '{{NUMERO}}': esc(q.numero),
    '{{DATA_LUNGA}}': esc(dataLunga(q.data)),
    '{{FOOTER_LEFT}}': esc([
      em.nome,
      em.indirizzo,
      em.piva ? `P.IVA ${em.piva}` : '',
      em.sito,
    ].filter(Boolean).join(' \u2014 ')),
  };

  let out = tpl;
  for (const [k, v] of Object.entries(sostituzioni)) {
    out = out.split(k).join(v);
  }
  const body = q.template === 'tecnico' ? buildTecnicoBody(q) : buildServiziBody(q);
  out = out.replace('<!--BODY-->', body);
  return out;
}

module.exports = { renderHTML, esc, wordmark };
