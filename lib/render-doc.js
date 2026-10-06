'use strict';

/* Documento a blocchi -> HTML completo, con le due estetiche storiche
   ("servizi" chiara e "tecnico" navy/oro). La cornice (testata, piè, dati
   preventivo/cliente) e' fissa per tema; i blocchi scorrono sotto
   nell'ordine in cui sono nell'array, qualunque esso sia. */

const { fmtEuro, dataLunga } = require('./quote');
const { esc: escBase, wordmark } = require('./render');

function esc(v) {
  return escBase(v);
}

function line(v) {
  const t = String(v == null ? '' : v).trim();
  return t ? `<div>${esc(t)}</div>` : '';
}

function bloccoOpzionale(html) {
  return html ? `${html}\n        ` : '';
}

/* ---------- blocchi ---------- */

function bloccoTitolo(b, tema) {
  return `
    <div class="sec-title">${esc(b.testo)}</div>
    ${b.sottotesto ? `<div class="sec-sub">${esc(b.sottotesto)}</div>` : ''}`;
}

function bloccoTesto(b) {
  return `<div class="sec-par">${esc(b.testo)}</div>`;
}

function bloccoNota(b) {
  return `<div class="nota">${esc(b.testo)}</div>`;
}

function bloccoElenco(b) {
  return `
    <ul class="cond">
      ${b.items.map((x) => `<li>${esc(x)}</li>`).join('\n      ')}
    </ul>`;
}

function bloccoFasi(b) {
  return `
    <table class="tb">
      <thead><tr><th class="w-fase c">FASE</th><th>ATTIVIT&Agrave;</th></tr></thead>
      <tbody>
        ${b.items.map((f, i) => `
        <tr>
          <td class="fase-num">${String(i + 1).padStart(2, '0')}</td>
          <td><div class="v-tit">${esc(f)}</div></td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function bloccoVoci(b) {
  const conPrezzi = b.items.some((v) => v.prezzo !== null);
  const righe = b.items.map((v, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td>
            <div class="sv-tit">${esc(v.titolo)}</div>
            ${v.descrizione ? `<div class="sv-desc">${esc(v.descrizione)}</div>` : ''}
          </td>
          <td class="qt">${v.quantita}</td>
          <td class="imp">${v.prezzo === null ? 'Incluso' : `&euro; ${fmtEuro(v.prezzo)}`}</td>
        </tr>`).join('');
  return `
    <table class="tb voci">
      <thead>
        <tr><th class="num">#</th><th>DESCRIZIONE</th>${conPrezzi ? '<th class="w-qt c">Q.T&Agrave;</th><th class="w-importo r">IMPORTO</th>' : '<th class="w-qt c">Q.T&Agrave;</th>'}
        </tr>
      </thead>
      <tbody>${righe}
      </tbody>
    </table>`;
}

function bloccoTabella(b) {
  const th = b.intestazioni.map((h) => `<th>${esc(h)}</th>`).join('');
  const righe = b.righe.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  return `
    <table class="tb">
      ${th ? `<thead><tr>${th}</tr></thead>` : ''}
      <tbody>${righe}
      </tbody>
    </table>`;
}

function bloccoRiepilogo(b, doc) {
  const rate = b.rate ? `
    <div class="trow rate"><span class="lbl">${esc(b.rate.testo)}</span><span class="val">${esc(b.rate.importoTesto)}</span></div>` : '';
  return `
    <div class="totals">
      <div class="trow"><span class="lbl">${esc(b.etichettaImponibile)}</span><span class="val">&euro; ${fmtEuro(doc.imponibile)}</span></div>
      <div class="trow"><span class="lbl">IVA ${String(doc.ivaPercent).replace('.00', '')}%</span><span class="val">&euro; ${fmtEuro(doc.ivaImporto)}</span></div>
      <div class="trow tot"><span class="lbl">${esc(b.etichettaTotale)}</span><span class="val">&euro; ${fmtEuro(doc.totale)}</span></div>${rate}
    </div>`;
}

function bloccoCondizioni(b, tema) {
  const label = tema === 'tecnico'
    ? '<div class="sec-title">CONDIZIONI</div>'
    : `<div class="cond-label">${esc((b.etichetta || 'Condizioni').toUpperCase())}</div>`;
  return `
    ${label}
    <ul class="cond">
      ${b.items.map((c) => `<li>${esc(c)}</li>`).join('\n      ')}
    </ul>`;
}

function bloccoFirma(b, doc) {
  if (doc.tema === 'tecnico') {
    return `
    <div class="sec-title">PER ACCETTAZIONE</div>
    <div class="acc-row">
      <div class="acc-col"><div class="acc-line"></div><div class="acc-lbl">Data</div></div>
      <div class="acc-col"><div class="acc-line"></div><div class="acc-lbl">Firma del cliente</div></div>
    </div>`;
  }
  const emittenteNome = b.emittenteNome || 'Azienda';
  return `
    <div class="sig-row">
      <div class="sig">
        <div class="sig-a">${esc(emittenteNome)}</div>
        ${b.emittenteRuolo ? `<div class="sig-b">${esc(b.emittenteRuolo)}</div>` : ''}
        <div class="sig-line"></div>
      </div>
      <div class="sig">
        <div class="sig-a">Per accettazione</div>
        ${b.clienteNome || doc.cliente.nome ? `<div class="sig-b">${esc(b.clienteNome || doc.cliente.nome)}</div>` : '<div class="sig-b">&nbsp;</div>'}
        <div class="sig-line"></div>
      </div>
    </div>`;
}

function renderBlocco(b, doc) {
  switch (b.tipo) {
    case 'titolo': return bloccoTitolo(b, doc.tema);
    case 'testo': return bloccoTesto(b);
    case 'nota': return bloccoNota(b);
    case 'elenco': return bloccoElenco(b);
    case 'fasi': return bloccoFasi(b);
    case 'voci': return bloccoVoci(b);
    case 'tabella': return bloccoTabella(b);
    case 'riepilogo': return bloccoRiepilogo(b, doc);
    case 'condizioni': return bloccoCondizioni(b, doc.tema);
    case 'firma': return bloccoFirma(b, doc);
    default: return '';
  }
}

/* ---------- sezione intro fissa per tema ---------- */

function introServizi(doc) {
  const cl = doc.cliente;
  const dest = [
    line(cl.nome),
    line(cl.indirizzo),
    cl.piva ? `<div>P.IVA ${esc(cl.piva)}</div>` : '',
    line(cl.email),
    line(cl.telefono),
  ].join('');
  return `
    <div class="cols">
      <div>
        <div class="col-label">DESTINATARIO</div>
        ${dest}
      </div>
      <div>
        <div class="col-label">PREVENTIVO</div>
        <div class="pv-num">N. <b>${esc(doc.numero)}</b></div>
        <div class="pv-meta">
          <div>Data: ${esc(doc.data)}</div>
          <div>Validit&agrave;: ${esc(doc.validita)}</div>
        </div>
      </div>
    </div>
    <div class="oggetto">Oggetto: ${esc(doc.oggetto)}</div>
    ${doc.intro ? `<div class="intro">${esc(doc.intro)}</div>` : ''}`;
}

function introTecnico(doc) {
  const cl = doc.cliente;
  const boxDettagli = `
      <div class="box">
        <div class="box-head">DETTAGLI PREVENTIVO</div>
        <div class="box-body">
          <div class="brow"><div class="blbl">NUMERO</div><div class="bval">${esc(doc.numero)}</div></div>
          <div class="brow"><div class="blbl">DATA EMISSIONE</div><div class="bval">${esc(dataLunga(doc.data))}</div></div>
          <div class="brow"><div class="blbl">PAGAMENTO</div><div class="bval">${esc(doc.pagamento)}</div></div>
        </div>
      </div>`;
  const boxCliente = `
      <div class="box">
        <div class="box-head">DATI CLIENTE</div>
        <div class="box-body">
          <div class="brow"><div class="blbl">INTESTATARIO</div><div class="bval">${esc(cl.nome) || '&mdash;'}</div></div>
          ${cl.indirizzo ? `<div class="brow"><div class="blbl">INDIRIZZO</div><div class="bval">${esc(cl.indirizzo)}</div></div>` : ''}
          ${cl.piva ? `<div class="brow"><div class="blbl">P.IVA</div><div class="bval">${esc(cl.piva)}</div></div>` : ''}
          <div class="brow"><div class="blbl">OGGETTO</div><div class="bval">${esc(doc.oggetto)}</div></div>
        </div>
      </div>`;
  return `
    <div class="pv-title">PREVENTIVO</div>
    <div class="pv-sub">Offerta economica per ${esc(doc.oggetto.charAt(0).toLowerCase() + doc.oggetto.slice(1))}</div>
    <div class="gold-bar"></div>
    <div class="boxes">${boxDettagli}${boxCliente}
    </div>
    <div class="sec-title first">OGGETTO DELL'INTERVENTO</div>
    <div class="sec-par">${esc(doc.intro || doc.oggetto)}</div>`;
}

/* ---------- shell CSS per tema ---------- */

const CSS_COMUNE = `
  :root { --ink: #1f2937; --muted: #6b7280; --hair: #e5e7ee; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: A4; margin: 0; }
  html, body { width: 210mm; }
  body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: var(--ink); font-size: 9.5pt; line-height: 1.45; background: #fff; }
  table.w { width: 210mm; border-collapse: collapse; }
  table.w > tbody > tr > td, table.w > thead > tr > td, table.w > tfoot > tr > td { padding: 0; vertical-align: top; }
  table.w > tbody > tr > td { height: calc(297mm - var(--hdr-h) - var(--ftr-h) - 1.5mm); background: #fff; }
  .pg-body { padding: 8mm 16mm 7mm; }
  .sec-title { font-size: 11pt; font-weight: 800; letter-spacing: 0.3pt; margin-top: 8.5mm; padding-bottom: 2.2mm; border-bottom: 1px solid #d8dce3; page-break-after: avoid; }
  .sec-title.first { margin-top: 7mm; }
  .sec-sub { font-size: 9pt; color: var(--muted); margin-top: 1.5mm; }
  .sec-par { margin-top: 3mm; text-align: justify; page-break-inside: avoid; }
  table.tb { width: 100%; border-collapse: collapse; margin-top: 4mm; }
  table.tb thead th { font-size: 9pt; font-weight: 700; letter-spacing: 0.3pt; text-align: left; padding: 3mm 4mm; }
  table.tb thead th.c, td.c { text-align: center; }
  table.tb thead th.r { text-align: right; }
  table.tb thead th.num { width: 12mm; text-align: center; }
  table.tb thead th.w-fase { width: 20mm; }
  table.tb thead th.w-qt { width: 18mm; }
  table.tb thead th.w-importo { width: 32mm; }
  table.tb tbody tr { page-break-inside: avoid; }
  table.tb tbody td { padding: 3.4mm 4mm; border-bottom: 1px solid var(--hair); vertical-align: top; }
  table.tb td.num { text-align: center; color: var(--muted); font-size: 10pt; }
  td.fase-num { text-align: center; font-size: 12.5pt; font-weight: 800; }
  .v-tit { font-weight: 700; font-size: 9.5pt; }
  .sv-desc, .v-desc { color: var(--muted); font-size: 8.5pt; margin-top: 1mm; }
  td.qt { text-align: center; font-size: 9pt; color: #374151; }
  td.imp { text-align: right; font-weight: 700; font-size: 9.5pt; white-space: nowrap; }
  .totals { width: 64%; margin-left: auto; margin-top: 6.5mm; font-size: 10pt; page-break-inside: avoid; }
  .totals .trow { display: flex; justify-content: space-between; padding: 2.3mm 0; }
  .totals .trow .lbl { color: #111827; }
  .totals .trow .val { font-weight: 700; color: #111827; white-space: nowrap; }
  .totals .trow.rate .lbl, .totals .trow.rate .val { font-weight: 400; }
  .totals .trow.tot { border-top: 0.5mm solid var(--accent-strong); font-weight: 700; }
  .totals .trow.tot .val { font-weight: 700; }
  ul.cond { list-style: none; margin-top: 3mm; }
  ul.cond li { position: relative; padding-left: 4mm; font-size: 9pt; color: #374151; margin-bottom: 1.2mm; page-break-inside: avoid; }
  ul.cond li::before { content: "\\2022"; position: absolute; left: 0.5mm; }
  .nota { margin-top: 3mm; font-size: 9pt; color: #374151; page-break-inside: avoid; }
  .pg-footer { text-align: center; font-size: 8pt; color: var(--muted); line-height: 1.5; background: #fff; }
  .pg-footer .legal { font-style: italic; }
`;

const CSS_SERVIZI = `
  :root { --navy: #0f1b3d; --blue: #2f6bff; --accent-strong: var(--navy); --hdr-h: 27mm; --ftr-h: 11mm; }
  ${CSS_COMUNE}
  table.w > thead > tr > td { height: var(--hdr-h); background: #fff; }
  table.w > tfoot > tr > td { height: var(--ftr-h); border-top: 1px solid var(--hair); }
  .pg-header { padding: 12mm 16mm 0; background: #fff; }
  .head-row { display: flex; justify-content: space-between; align-items: flex-start; }
  .wordmark { font-size: 21pt; font-weight: 800; letter-spacing: -0.4pt; color: var(--navy); }
  .head-info { text-align: right; font-size: 8pt; color: var(--muted); line-height: 1.55; }
  .head-info .em-nome { color: #111827; }
  .head-rule { border-bottom: 1.1mm solid var(--blue); margin-top: 4.5mm; }
  .cols { display: flex; justify-content: space-between; gap: 10mm; }
  .col-label { font-size: 7.5pt; font-weight: 700; letter-spacing: 0.6pt; color: var(--blue); margin-bottom: 1.8mm; }
  .client-lines div, .pv-meta div { font-size: 9.5pt; color: #374151; }
  .client-name { font-weight: 700; font-size: 10.5pt; color: #111827; }
  .pv-num { font-size: 10.5pt; color: #111827; }
  .pv-num b { font-weight: 700; }
  .oggetto { font-size: 15.5pt; font-weight: 700; color: var(--navy); margin-top: 8mm; letter-spacing: -0.2pt; }
  .intro { margin-top: 2.6mm; color: #374151; }
  .sec-title { color: var(--navy); }
  .cond-label { font-size: 7.5pt; font-weight: 700; letter-spacing: 0.6pt; color: var(--blue); margin-top: 9mm; margin-bottom: 2mm; page-break-after: avoid; }
  .sig-row { display: flex; justify-content: space-between; margin-top: 13mm; gap: 20mm; page-break-inside: avoid; }
  .sig { flex: 1; }
  .sig .sig-a { font-weight: 600; color: #111827; }
  .sig .sig-b { color: #374151; }
  .sig-line { width: 44mm; border-bottom: 1px solid #111827; margin-top: 13mm; }
  .pg-footer { padding: 2.8mm 16mm 4mm; font-size: 7.5pt; }
`;

const CSS_TECNICO = `
  :root { --navy: #1c2848; --gold: #d4a93e; --soft: #edf1f7; --accent-strong: var(--navy); --hdr-h: 31mm; --ftr-h: 13mm; }
  ${CSS_COMUNE}
  table.w > thead > tr > td { height: var(--hdr-h); background: var(--navy); border-bottom: 1.4mm solid var(--gold); }
  table.w > tfoot > tr > td { height: var(--ftr-h); border-top: 1.4mm solid var(--gold); border-bottom: 1px solid #e8e9ee; }
  .pg-header { padding: 8mm 16mm 6.5mm; }
  .head-row { display: flex; justify-content: space-between; align-items: flex-start; }
  .wordmark { font-size: 20pt; font-weight: 800; letter-spacing: 0.2pt; color: #fff; }
  .tagline { font-size: 8.5pt; color: #aab2c5; margin-top: 1.6mm; }
  .head-info { text-align: right; font-size: 8.5pt; color: #b7bdc9; line-height: 1.6; }
  .pv-title { font-size: 24pt; font-weight: 800; color: var(--navy); letter-spacing: 0.5pt; }
  .pv-sub { font-size: 10pt; color: var(--muted); margin-top: 2mm; }
  .gold-bar { width: 30mm; height: 1.1mm; background: var(--gold); margin-top: 3mm; }
  .boxes { display: flex; gap: 5mm; margin-top: 7.5mm; page-break-inside: avoid; }
  .box { flex: 1; }
  .box-head { background: var(--navy); color: #fff; font-size: 9pt; font-weight: 700; letter-spacing: 0.3pt; padding: 2.8mm 4mm; }
  .box-body { background: var(--soft); padding: 3.5mm 4mm 4mm; }
  .brow { display: flex; gap: 4mm; margin-bottom: 3mm; }
  .brow:last-child { margin-bottom: 0; }
  .brow .blbl { width: 34mm; flex: none; font-size: 7.5pt; color: var(--muted); letter-spacing: 0.3pt; padding-top: 0.7mm; }
  .brow .bval { flex: 1; font-size: 9.5pt; font-weight: 700; color: var(--navy); }
  .sec-title { color: var(--navy); }
  table.tb thead th { background: var(--navy); color: #fff; }
  .totals .trow { padding: 2.2mm 4mm; }
  .totals .trow .lbl { color: #374151; }
  .totals .trow.tot { background: var(--navy); padding: 3.4mm 4mm; }
  .totals .trow.tot .lbl, .totals .trow.tot .val { color: #fff; letter-spacing: 0.3pt; }
  .acc-row { display: flex; justify-content: space-between; gap: 18mm; margin-top: 14mm; page-break-inside: avoid; }
  .acc-col { flex: 1; }
  .acc-line { border-bottom: 1px solid #1f2937; height: 10mm; }
  .acc-lbl { font-size: 8.5pt; color: var(--muted); margin-top: 1.6mm; }
  .pg-footer { padding: 3mm 16mm 3.4mm; }
`;

/* ---------- cornice e composizione ---------- */

function headerServizi(em) {
  return `
          <div class="pg-header">
            <div class="head-row">
              <div class="wordmark">${esc(wordmark(em.nome))}</div>
              <div class="head-info">
                <div class="em-nome">${esc(em.nome || 'Azienda')}</div>
                ${bloccoOpzionale(line(em.indirizzo))}
                ${bloccoOpzionale(em.piva ? `<div>P. IVA ${esc(em.piva)}</div>` : '')}
                ${bloccoOpzionale(line(em.sito))}
              </div>
            </div>
            <div class="head-rule"></div>
          </div>`;
}

function headerTecnico(em) {
  return `
          <div class="pg-header">
            <div class="head-row">
              <div>
                <div class="wordmark">${esc(wordmark(em.nome))}</div>
                ${bloccoOpzionale(em.tagline ? `<div class="tagline">${esc(em.tagline)}</div>` : '')}
              </div>
              <div class="head-info">
                ${bloccoOpzionale(line(em.indirizzo))}
                ${bloccoOpzionale(em.piva ? `<div>P. IVA ${esc(em.piva)}</div>` : '')}
              </div>
            </div>
          </div>`;
}

function renderDocHTML(doc, impostazioni) {
  const tema = doc.tema === 'tecnico' ? 'tecnico' : 'servizi';
  const em = (impostazioni && impostazioni.emittente) || {};
  const cb = doc.coordinateBancarie;

  const footerServizi = `<div>${esc([
    em.nome,
    em.indirizzo,
    em.piva ? `P.IVA ${em.piva}` : '',
    em.sito,
  ].filter(Boolean).join(' \u2014 '))}</div>`;

  const footerTecnico = `
            <div>Preventivo n. ${esc(doc.numero)} · Emesso il ${esc(dataLunga(doc.data))}</div>
            <div class="legal">Documento non fiscale. Per accettazione restituire una copia firmata.</div>`;

  const blocchi = doc.blocchi.map((b) => renderBlocco(b, doc)).join('\n');

  const body = `
${tema === 'tecnico' ? introTecnico(doc) : introServizi(doc)}
${blocchi}
${cb && (cb.intestatoA || cb.iban) && tema === 'tecnico' ? `
    <div class="iban-box" style="background:#edf1f7;padding:4mm;margin-top:7mm;page-break-inside:avoid;">
      <div style="font-size:10pt;font-weight:800;color:#1c2848;">COORDINATE BANCARIE PER IL PAGAMENTO</div>
      ${cb.intestatoA ? `<div style="display:flex;gap:6mm;margin-top:2.8mm;font-size:9.5pt;"><div style="width:26mm;flex:none;color:#4b5563;">Intestato a:</div><div style="font-weight:700;">${esc(cb.intestatoA)}</div></div>` : ''}
      ${cb.iban ? `<div style="display:flex;gap:6mm;margin-top:2.8mm;font-size:9.5pt;"><div style="width:26mm;flex:none;color:#4b5563;">IBAN:</div><div style="font-weight:700;">${esc(cb.iban)}</div></div>` : ''}
    </div>` : ''}
${cb && (cb.intestatoA || cb.iban) && tema === 'servizi' ? `
    <div style="margin-top:7mm;font-size:9pt;color:#374151;">Pagamento tramite ${esc(doc.pagamento)}${cb.intestatoA ? ` intestato a <b>${esc(cb.intestatoA)}</b>` : ''}${cb.iban ? ` \u2014 IBAN <b>${esc(cb.iban)}</b>` : ''}.</div>` : ''}
  `;

  const css = tema === 'tecnico' ? CSS_TECNICO : CSS_SERVIZI;
  const header = tema === 'tecnico' ? headerTecnico(em) : headerServizi(em);
  const footer = tema === 'tecnico' ? footerTecnico : footerServizi;

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<title>Preventivo</title>
<style>${css}</style>
</head>
<body>
  <table class="w">
    <thead>
      <tr><td>${header}</td></tr>
    </thead>
    <tfoot>
      <tr><td><div class="pg-footer">${footer}</div></td></tr>
    </tfoot>
    <tbody>
      <tr><td><div class="pg-body">
        ${body}
      </div></td></tr>
    </tbody>
  </table>
</body>
</html>`;
}

module.exports = { renderDocHTML };
