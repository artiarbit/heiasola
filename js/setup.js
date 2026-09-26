// First-time setup screen: join Ørjan's app group, or use your own Spotify developer app.

import { state, toast } from './state.js';
import { startLogin, usingDefaultApp } from './spotify.js';
import { DEFAULT_CLIENT_ID, REDIRECT_URI, OWNER } from './config.js';
import { $, copyText } from './dom.js';

export function showSetupError(message) {
  $('setupErr').textContent = message || '';
}

async function login(clientId) {
  showSetupError(await startLogin(clientId));
}

export function initSetup() {
  $('redir').textContent = REDIRECT_URI;
  $('cid').value = usingDefaultApp() ? '' : state.clientId;

  $('loginDefault').addEventListener('click', () => login(DEFAULT_CLIENT_ID));
  $('loginBtn').addEventListener('click', () => login($('cid').value.trim()));
  $('copyRedir').addEventListener('click', () => copyText(REDIRECT_URI, 'Copied.'));
  $('copyRequest').addEventListener('click', async () => {
    const msg = `Hi ${OWNER}! Can you add me to the HEIA SOLA! app?\nName: \nSpotify email: `;
    if (!(await copyText(msg, `Copied. Paste it into a message to ${OWNER} and fill in your name and Spotify email.`))) {
      toast(`Send ${OWNER} your name and the email of your Spotify account.`, 'info');
    }
  });
}
