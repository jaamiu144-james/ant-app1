/* ---------------------------------------------------------------------
   loadEnv.js — tiny stand-in for the `dotenv` package (not installable
   in the sandbox this was built in — see SETUP.md). Reads a .env file
   next to server/ if one exists and copies KEY=VALUE lines into
   process.env (without overwriting anything already set by the host —
   most real hosting platforms inject env vars directly and won't have
   a .env file at all, which is fine, this just does nothing then).
--------------------------------------------------------------------- */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');

if(fs.existsSync(ENV_PATH)){
  const text = fs.readFileSync(ENV_PATH, 'utf8');
  text.split('\n').forEach(line=>{
    const trimmed = line.trim();
    if(!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if(eq < 0) return;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq+1).trim();
    if((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if(!(key in process.env)) process.env[key] = val;
  });
}
