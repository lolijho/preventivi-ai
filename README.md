# Preventivi AI

Generatore di preventivi in PDF: descrivi il lavoro in italiano, l'AI **GLM 5.3 Flash** (via OpenRouter) struttura cliente, voci, fasi e prezzi, e l'app compone il documento in uno dei due layout professionali inclusi:

- **Servizi** — stile "All Soft X": testata chiara, accenti blu, tabella dei servizi, riepilogo canone/IVA/totale, condizioni e firme.
- **Tecnico** — stile "CAMS": testata navy con banda oro, box dettagli/cliente, fasi della lavorazione, riepilogo economico con "Incluso", coordinate bancarie.

## Avvio (sviluppo locale)

```bash
npm install
cp .env.example .env   # e incolla la tua chiave OPENROUTER_API_KEY
npm start
```

Apri `http://localhost:3000`. Senza `DATABASE_URL` i dati stanno in file JSON (`data/`).

## Deploy con Docker e Postgres

L'immagine (`node:22-alpine` + Chromium + font Liberation/Free) genera i PDF dentro il container:

```bash
docker build -t preventivi-ai .
docker run -p 3000:3000 \
  -e OPENROUTER_API_KEY=... \
  -e DATABASE_URL=postgres://utente:password@host:5432/postgres \
  preventivi-ai
```

Con `DATABASE_URL` impostata archivio, contatori e impostazioni stanno su **Postgres**
(tabelle `preventivi`, `contatori`, `impostazioni`, create automaticamente al primo avvio;
se i file `data/*.json` esistono ancora vengono importati una sola volta).
Su Coolify basta creare un database Postgres nell'ambiente dell'app e impostare le
variabili `DATABASE_URL`, `OPENROUTER_API_KEY` e `OPENROUTER_MODEL`.

## Come si usa

1. **Impostazioni** (in alto a destra): inserisci una volta sola i dati della tua azienda e l'IBAN. Verranno usati in tutti i preventivi.
2. **Descrivi il lavoro** in testo libero (email, messaggio WhatsApp, appunti): l'AI sceglie il layout (o forzalo con *Auto / Servizi / Tecnico*), propone prezzi di mercato se mancano e riempie condizioni e note.
3. **Modifica** tutto nel pannello a sinistra: l'anteprima si aggiorna in tempo reale.
4. **Scarica PDF** (generato con Chrome headless, identico all'anteprima) o **Salva in archivio**.

## Numerazione

I numeri vengono assegnati automaticamente se l'AI non ne propone uno:

- layout *Servizi*: `PRV-AAAA-MMGG-NN` (progressivo giornaliero)
- layout *Tecnico*: `PREV-AAAA-NNN` (progressivo annuale)

## Architettura

```
server.js            API Express (generate / render / pdf / archivio / impostazioni)
lib/ai.js            chiamata a GLM 5.3 Flash via OpenRouter → JSON del preventivo
lib/quote.js         normalizzazione: campi, totali (imponibile, IVA, totale), numerazione
lib/render.js        preventivo JSON → HTML (compone i template)
lib/pdf.js           Chrome headless (puppeteer-core) → PDF A4 con sfondi
templates/           i due layout (CSS di stampa incorporato, testata/piè ripetuti)
public/              interfaccia (vanilla JS, anteprima live in iframe)
data/                archivio preventivi, contatori, impostazioni (gitignored)
```

Il flusso è deliberatamente **AI → JSON → template deterministico**: l'AI non genera il PDF direttamente, quindi il risultato è sempre pulito, coerente e modificabile campo per campo.
