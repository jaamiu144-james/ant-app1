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

const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='5' fill='%230b5d56'/%3E%3Cg fill='none' stroke='%23f5ead9' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='6.3' r='1.7'/%3E%3Ccircle cx='12' cy='11.2' r='2.3'/%3E%3Ccircle cx='12' cy='16.8' r='2.7'/%3E%3Cpath d='M12 8v1.1M12 13.3v1.1'/%3E%3Cpath d='M9.7 4.7 7.3 3M14.3 4.7 16.7 3'/%3E%3Cpath d='M4.3 9.3l4.3 1.9M19.7 9.3l-4.3 1.9'/%3E%3Cpath d='M3.4 13l5.2 1M20.6 13l-5.2 1'/%3E%3Cpath d='M4.3 19.5l5.2-3.3M19.7 19.5l-5.2-3.3'/%3E%3C/g%3E%3C/svg%3E";

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
<link rel="icon" href="${FAVICON}">
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
