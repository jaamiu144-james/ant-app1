/* ---------------------------------------------------------------------
   appBundle.js — builds the SPA HTML for the hosted app, once per
   edition, cached in memory. Same source files and concatenation order
   as ../../build.js (which produces the standalone downloadable
   editions), plus lib/cloud.js appended and window.CLOUD_MODE/
   window.APP_EDITION stamped in per tenant at request time — see
   index.js's serveApp().
--------------------------------------------------------------------- */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', '..', 'src');

const LIB_ORDER = ['util.js','store.js','auth.js','ledger.js','pricing.js','availability.js','posting.js','cloud.js'];
const MODULE_ORDER = [
  'customers.js','guests.js','vendors.js','equipment.js','packages.js','pricelists.js','fleet.js',
  'calendar.js','bookings.js','invoices.js','manifest.js','cash.js','deposits.js','reconciliation.js','vouchers.js','pettycash.js','bills.js',
  'payroll.js','tax.js','accounts.js','reports.js','settings.js','waivers.js','dashboard.js'
];

function read(p){ return fs.readFileSync(p, 'utf8'); }

let cachedShell = null;
function buildShell(){
  if(cachedShell) return cachedShell;
  const css = read(path.join(SRC, 'styles.css'));
  const libJs = LIB_ORDER.map(f=>`/* ---- lib/${f} ---- */\n`+read(path.join(SRC,'lib',f))).join('\n\n');
  const modJs = MODULE_ORDER.map(f=>`/* ---- modules/${f} ---- */\n`+read(path.join(SRC,'modules',f))).join('\n\n');
  const appJs = read(path.join(SRC, 'app.js'));
  cachedShell = { css, libJs, modJs, appJs };
  return cachedShell;
}

// edition: 'front' | 'back' | 'full'. companyName is used only for the
// <title> on first paint (before the app's own boot sets it from the
// loaded data) — cosmetic.
export function renderAppHtml({ edition }){
  const { css, libJs, modJs, appJs } = buildShell();
  const editionStamp = edition && edition !== 'full' ? `window.APP_EDITION = ${JSON.stringify(edition)};\n` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ant App</title>
<link rel="icon" href="/icons/favicon-32.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0b5d56">
<script src="/pwa-install.js" defer></script>
<style>
${css}
</style>
</head>
<body>
<script>
window.CLOUD_MODE = true;
${editionStamp}${libJs}

${modJs}

${appJs}
</script>
</body>
</html>
`;
}
