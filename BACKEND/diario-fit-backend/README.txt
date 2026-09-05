DIARIO FIT - BACKEND / PASSO 1

Cosa contiene
- worker.js: API Cloudflare Worker
- migrations/0001_initial.sql: schema D1
- wrangler.toml: configurazione base

Architettura scelta
- GitHub Pages resta il frontend.
- Cloudflare Worker espone /api/*.
- Cloudflare D1 conserva utenti, sessioni, profili, impostazioni e giornate.
- Le password NON sono memorizzate in chiaro: PBKDF2 + salt.
- Il token di sessione viene restituito al frontend e usato come Bearer token.

PRIMO SETUP
1. Crea un database D1 chiamato diario-fit.
2. Copia il suo database_id in wrangler.toml.
3. Imposta ALLOWED_ORIGIN con l'URL esatto della GitHub Pages.
4. Crea il secret REGISTRATION_INVITE_CODE con Wrangler.
5. Applica la migration.
6. Pubblica il Worker.

Comandi tipici:
  npx wrangler d1 create diario-fit
  npx wrangler secret put REGISTRATION_INVITE_CODE
  npx wrangler d1 migrations apply diario-fit --remote
  npx wrangler deploy

La PRIMA registrazione diventa automaticamente admin.
Le registrazioni successive richiedono REGISTRATION_INVITE_CODE.
In questo modo non lasciamo aperta la creazione libera di account.

NOTA
Non mettere password, token, database_id sensibili o chiavi Gemini dentro index.html.
Il database_id non è una credenziale segreta, ma viene comunque configurato nel progetto Worker.
