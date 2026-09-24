#!/usr/bin/env node
/* Bundles src/ into self-contained dist/*.html file(s).

   Three sellable editions come out of this one source tree — the full
   module code ships in every bundle (reports, postings, etc. read across
   both sides of the business), only navigation/routing is gated per
   edition at runtime by EditionGuard (see src/app.js + the guard in
   src/lib/util.js's Router.render). That keeps all three editions on the
   exact same, single-tested codepath.

   Usage:
     node build.js                 → dist/dive-erp.html            (Complete, unrestricted — default)
     node build.js --edition=front → dist/dive-erp-front-office.html
     node build.js --edition=back  → dist/dive-erp-back-office.html
     node build.js --all           → builds all three into dist/
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, 'src');
const OUT_DIR = path.join(__dirname, 'dist');

const LIB_ORDER = ['util.js','store.js','auth.js','ledger.js','pricing.js','availability.js','posting.js'];
const MODULE_ORDER = [
  'customers.js','guests.js','vendors.js','equipment.js','packages.js','pricelists.js','fleet.js',
  'calendar.js','bookings.js','invoices.js','manifest.js','cash.js','deposits.js','reconciliation.js','vouchers.js','pettycash.js','bills.js',
  'payroll.js','tax.js','accounts.js','reports.js','settings.js','waivers.js','dashboard.js'
];

const EDITIONS = {
  full:  { file:'dive-erp.html',             title:'Ant App',              apiEdition: null    },
  front: { file:'dive-erp-front-office.html', title:'Ant App — Front Office', apiEdition:'front' },
  back:  { file:'dive-erp-back-office.html',  title:'Ant App — Back Office',  apiEdition:'back'  },
};

const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='5' fill='%230b5d56'/%3E%3Cg fill='none' stroke='%23f5ead9' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='6.3' r='1.7'/%3E%3Ccircle cx='12' cy='11.2' r='2.3'/%3E%3Ccircle cx='12' cy='16.8' r='2.7'/%3E%3Cpath d='M12 8v1.1M12 13.3v1.1'/%3E%3Cpath d='M9.7 4.7 7.3 3M14.3 4.7 16.7 3'/%3E%3Cpath d='M4.3 9.3l4.3 1.9M19.7 9.3l-4.3 1.9'/%3E%3Cpath d='M3.4 13l5.2 1M20.6 13l-5.2 1'/%3E%3Cpath d='M4.3 19.5l5.2-3.3M19.7 19.5l-5.2-3.3'/%3E%3C/g%3E%3C/svg%3E";

function read(p){ return fs.readFileSync(p, 'utf8'); }

function build(editionKey){
  const ed = EDITIONS[editionKey];
  const css = read(path.join(SRC, 'styles.css'));
  const libJs = LIB_ORDER.map(f=>`/* ---- lib/${f} ---- */\n`+read(path.join(SRC,'lib',f))).join('\n\n');
  const modJs = MODULE_ORDER.map(f=>`/* ---- modules/${f} ---- */\n`+read(path.join(SRC,'modules',f))).join('\n\n');
  const appJs = read(path.join(SRC, 'app.js'));
  const editionStamp = ed.apiEdition ? `window.APP_EDITION = ${JSON.stringify(ed.apiEdition)};\n` : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml((process.env.APP_TITLE)||ed.title)}</title>
<link rel="icon" href="${FAVICON}">
<style>
${css}
</style>
</head>
<body>
<script>
${editionStamp}${libJs}

${modJs}

${appJs}
</script>
</body>
</html>
`;

  fs.mkdirSync(OUT_DIR, { recursive:true });
  const outPath = path.join(OUT_DIR, ed.file);
  fs.writeFileSync(outPath, html, 'utf8');
  console.log('Built', outPath, `(${(html.length/1024).toFixed(0)} KB)`);
}

function escapeHtml(s){ return s.replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

const args = process.argv.slice(2);
const editionArg = (args.find(a=>a.startsWith('--edition='))||'').split('=')[1];

if(args.includes('--all')){
  Object.keys(EDITIONS).forEach(build);
} else if(editionArg){
  if(!EDITIONS[editionArg]){ console.error(`Unknown edition "${editionArg}". Use one of: ${Object.keys(EDITIONS).join(', ')}`); process.exit(1); }
  build(editionArg);
} else {
  build('full');
}
