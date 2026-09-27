// Fixed settings for the app. Change values here rather than hunting through the code.

/** Name shown to new users on the setup screen ("Join Ørjan's app group"). */
export const OWNER = 'Ørjan';

/** Ørjan's Spotify developer app. A Client ID is public, not a secret. */
export const DEFAULT_CLIENT_ID = 'd313ba4d10e0403fa567b4c59110550e';

/** Spotify permissions the app asks for at login. */
export const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';

/** Must match a Redirect URI registered in the Spotify dashboard exactly. */
export const REDIRECT_URI = location.origin + location.pathname;

/**
 * Online storage: the Cloudflare Worker running cloudflare/worker.js (Ørjan's Cloudflare account).
 * Set to '' to turn online storage off; buttons are then only kept on the phone.
 */
export const CLOUD_URL = '';  // switch on: 'https://dark-butterfly-3c23.artiarbit.workers.dev' (after the Worker code is deployed)

/** Track played on repeat between goals so the Spotify app on a phone doesn't fall asleep. */
export const SILENT_TRACK = 'Silence 10 Minutes';

/** Colour choices in the button editor. */
export const COLORS = ['#FFD400', '#FFE45C', '#F5B800', '#FFF1A0', '#FFC400', '#FFFFFF', '#E8C300', '#FFEB85'];

/** Device types the app may pick on its own. Speakers are only used when chosen in Settings. */
export const PERSONAL_DEVICE = /^(smartphone|computer|tablet)$/i;

export const TIMING = {
  pollOk: 20000,       // check Spotify devices this often when all is well
  pollMissing: 5000,   // ...and this often while the chosen device has gone to sleep
  pollRetry: 3000,     // quick retry after one failed check
  pollFailing: 8000,   // after two or more failed checks in a row
  pollRefused: 30000,  // account not allowed in the app (403): no point retrying fast
  startLagMs: 300,     // Spotify starts the sound a little after accepting the command
  fadeSteps: 5,        // volume steps in a fade-out
  stepMs: 50,          // start/end times snap to this
  minClipMs: 1000,
  maxClipMs: 600000,
  newClipMs: 6000,     // default length of a new clip
};
