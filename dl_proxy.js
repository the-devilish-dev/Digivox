/**
 * Devilish Labs Universal Dev Proxy_v2.1
 * Zero dependencies — uses only Node.js built-in modules.
 * Works on any Node version, including Termux/Android.
 *
 * Usage:  node dl_proxy.js
 * Runs on: http://localhost:2345 (override with PORT env)
 *
 * CHANGELOG v2.0:
 *  - FIX: /clone now correctly routes to https://api.fish.audio/model (no /v1/)
 *  - FIX: /my-voices passes through self=true & page_size query params correctly
 *  - FIX: /voice DELETE route now correctly targets /model/{id}
 *  - ADDED: /transcribe route to Fish Audio ASR endpoint
 */

const http  = require('http');
const https = require('https');
const url   = require('url');
const fs    = require('fs');
const path  = require('path');

const PORT     = parseInt(process.env.PORT, 10) || 2345;
const ROOT     = __dirname;
const PID_FILE = path.join(ROOT, 'digivox_proxy.pid');
// Never let the browser cache DigiVoX files — stale copies caused "fixed"
// bugs to keep reproducing on device while the server had new code.
const NO_CACHE = { 'Cache-Control': 'no-store, must-revalidate' };

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.gif':'image/gif', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.mp3':'audio/mpeg', '.wav':'audio/wav'
};

// ─── Route table ─────────────────────────────────────────────────────────────
// Fish Audio API base: https://api.fish.audio
// Note: TTS uses /v1/tts, but model CRUD uses /model (no /v1/)
// ─────────────────────────────────────────────────────────────────────────────
const ROUTES = [
  {
    prefix: '/horizons',
    target: 'https://ssd.jpl.nasa.gov/api/horizons.api'
  },
  {
    // /gemini/gemini-2.5-flash:generateContent?key=...
    prefix: '/gemini',
    target: 'https://generativelanguage.googleapis.com/v1beta/models'
  },
  {
    // TTS synthesis — uses /v1/tts
    prefix: '/tts',
    target: 'https://api.fish.audio/v1/tts'
  },
  {
    // FIX: Model creation (clone) — Fish Audio uses /model NOT /v1/model
    prefix: '/clone',
    target: 'https://api.fish.audio/model'
  },
  {
    // FIX: List user's own voices — /my-voices?self=true&page_size=20
    // The proxy strips /my-voices and passes remaining path + query to /model
    prefix: '/my-voices',
    target: 'https://api.fish.audio/model'
  },
  {
    prefix: '/voices',
    target: 'https://api.fish.audio/model'
  },
  {
    // FIX: Voice delete/get by ID — /voice/{id} → /model/{id}
    prefix: '/voice',
    target: 'https://api.fish.audio/model'
  },
  {
    // Transcription ASR
    prefix: '/transcribe',
    target: 'https://api.fish.audio/v1/asr'
  }
];

// ─── Core proxy function ──────────────────────────────────────────────────────
function proxyRequest(clientReq, clientRes, upstreamUrlStr) {
  const parsed    = url.parse(upstreamUrlStr);
  const isHttps   = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;

  const options = {
    hostname: parsed.hostname,
    port:     parsed.port || (isHttps ? 443 : 80),
    path:     parsed.path,   // includes query string
    method:   clientReq.method,
    headers:  Object.assign({}, clientReq.headers, {
      host: parsed.hostname  // must override host header for the upstream
    })
  };

  // Remove headers that break upstream TLS / cause issues
  delete options.headers['origin'];
  delete options.headers['referer'];

  const upstreamReq = transport.request(options, (upstreamRes) => {
    // CORS headers so the browser is happy
    clientRes.setHeader('Access-Control-Allow-Origin',  '*');
    Object.entries(NO_CACHE).forEach(([k, v]) => clientRes.setHeader(k, v));
    clientRes.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    clientRes.setHeader('Access-Control-Allow-Headers', '*');

    clientRes.writeHead(upstreamRes.statusCode, upstreamRes.headers);
    upstreamRes.pipe(clientRes);
  });

  upstreamReq.on('error', (err) => {
    console.error('[proxy error]', err.message);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502);
      clientRes.end('Proxy error: ' + err.message);
    }
  });

  clientReq.pipe(upstreamReq);
}

// ─── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const reqUrl = url.parse(req.url);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.writeHead(204);
    res.end();
    return;
  }

  // Match route
  for (const route of ROUTES) {
    if (reqUrl.pathname === route.prefix || reqUrl.pathname.startsWith(route.prefix + '/')) {
      // Strip the prefix; keep any sub-path + query string
      const remainder = reqUrl.pathname.slice(route.prefix.length); // e.g. '' or '/abc123'
      const query     = reqUrl.search || '';                         // e.g. '?self=true&page_size=20'
      const upstream  = route.target + remainder + query;

      console.log(`[${req.method}] ${req.url}`);
      console.log(`        → ${upstream}`);

      proxyRequest(req, res, upstream);
      return;
    }
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    let rel = decodeURIComponent(reqUrl.pathname || '/');
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (file.startsWith(ROOT + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', ...NO_CACHE });
      return fs.createReadStream(file).pipe(res);
    }
  }

  res.writeHead(404);
  res.end('ZODIAX Proxy: no route for ' + req.url);
});

server.listen(PORT, () => {
  try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch (e) { console.error('PID write failed:', e.message); }
  const cleanup = () => { try { fs.unlinkSync(PID_FILE); } catch (e) {} process.exit(0); };
  process.on('SIGINT', cleanup); process.on('SIGTERM', cleanup);
  console.log('');
  console.log('🚀 ZODIAX Universal Dev Proxy v2.0 — http://localhost:' + PORT);
  console.log('');
  console.log('   /horizons      →  https://ssd.jpl.nasa.gov/api/horizons.api');
  console.log('   /gemini/...    →  https://generativelanguage.googleapis.com/v1beta/models/...');
  console.log('   /tts           →  https://api.fish.audio/v1/tts');
  console.log('   /clone         →  https://api.fish.audio/model          [FIXED]');
  console.log('   /my-voices     →  https://api.fish.audio/model          [FIXED: passes self=true]');
  console.log('   /voice/{id}    →  https://api.fish.audio/model/{id}     [FIXED]');
  console.log('   /transcribe    →  https://api.fish.audio/v1/asr');
  console.log('');
  console.log('   Waiting for requests... (Ctrl+C to stop)');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('❌  Port ' + PORT + ' is already in use. Kill the existing process first:');
    console.error('    pkill -f "node dl_proxy"   or   kill $(lsof -t -i:' + PORT + ')');
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});
