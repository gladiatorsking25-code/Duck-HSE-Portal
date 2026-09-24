import { existsSync, readFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Install Node.js 22 or newer, then reopen START-PORTAL.cmd.');
if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  console.log('Created .env. Open it in Notepad and configure the private sheet connection.\nRead START-HERE.txt for the steps. No account or sheet data has been changed.');
  process.exitCode = 1;
} else {
  process.loadEnvFile('.env');
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath || !existsSync(keyPath)) {
    console.log('Connection setup is missing: set GOOGLE_APPLICATION_CREDENTIALS in .env to your private service-account JSON file.\nDo not put that file in the application folder or send its contents in chat.\nRead START-HERE.txt.');
    process.exitCode = 1;
  } else {
    let key;
    try { key = JSON.parse(readFileSync(keyPath, 'utf8')); } catch { throw new Error('The credentials file is not valid JSON.'); }
    if (key.type !== 'service_account' || !key.client_email || !key.private_key) throw new Error('This is not a service-account key file. Use the JSON key for the account shared on the sheet.');
    if (process.env.SMTP_HOST && !existsSync('node_modules/nodemailer')) throw new Error('Email dependency is missing. Run npm install --ignore-scripts in this folder.');
    console.log('Starting the portal. Keep this window open while using the app.');
    console.log('Open ' + (process.env.APP_ORIGIN || 'http://localhost:3000') + '/login.html in your browser.');
    try { await import('./index.mjs'); }
    catch (err) {
      console.error('Startup failed: ' + err.message);
      console.error('If the sheet has not been prepared, follow START-HERE.txt and run npm run setup first.');
      process.exitCode = 1;
    }
  }
}
