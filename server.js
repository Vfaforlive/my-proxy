const express = require('express');
const fetch = require('node-fetch');
const app = express();

// Cache: speichert bereits geladene Seiten
const cache = new Map();
const CACHE_TIME = 5 * 60 * 1000; // 5 Minuten

app.use(express.static('public'));

function toAbsolute(url, base) {
  try { return new URL(url, base).href; } catch { return null; }
}

function proxyUrl(url, base) {
  try {
    const absolute = toAbsolute(url, base);
    if (!absolute) return url;
    if (absolute.startsWith('data:')) return url;
    return '/proxy?url=' + encodeURIComponent(absolute);
  } catch { return url; }
}

function rewriteHtml(html, baseUrl) {
  html = html.replace(/href="([^"]+)"/g, (_, u) => `href="${proxyUrl(u, baseUrl)}"`);
  html = html.replace(/href='([^']+)'/g, (_, u) => `href='${proxyUrl(u, baseUrl)}'`);
  html = html.replace(/src="([^"]+)"/g, (_, u) => `src="${proxyUrl(u, baseUrl)}"`);
  html = html.replace(/src='([^']+)'/g, (_, u) => `src='${proxyUrl(u, baseUrl)}'`);
  html = html.replace(/srcset="([^"]+)"/g, (_, srcset) => {
    const rewritten = srcset.replace(/(https?:\/\/[^\s,]+)/g, u => proxyUrl(u, baseUrl));
    return `srcset="${rewritten}"`;
  });
  html = html.replace(/action="([^"]+)"/g, (_, u) => `action="${proxyUrl(u, baseUrl)}"`);
  html = html.replace(/url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/g, (_, u) => `url(${proxyUrl(u, baseUrl)})`);
  html = html.replace(/@import\s+['"]?(https?:\/\/[^'";\s]+)['"]?/g, (_, u) => `@import '${proxyUrl(u, baseUrl)}'`);
  html = html.replace(/<base[^>]*>/gi, '');

  const inject = `
<script>
(function() {
  const PROXY = '/proxy?url=';
  const orig = window.fetch;
  window.fetch = function(url, opts) {
    if (typeof url === 'string' && url.startsWith('http')) {
      url = PROXY + encodeURIComponent(url);
    }
    return orig.call(this, url, opts);
  };
  const origXHR = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (typeof url === 'string' && url.startsWith('http')) {
      url = PROXY + encodeURIComponent(url);
    }
    return origXHR.apply(this, arguments);
  };
})();
</script>`;

  html = html.replace('</head>', inject + '</head>');
  return html;
}

function rewriteCss(css, baseUrl) {
  css = css.replace(/url\(['"]?((?!data:)[^'")\s]+)['"]?\)/g, (_, u) => `url(${proxyUrl(u, baseUrl)})`);
  css = css.replace(/@import\s+['"]?(https?:\/\/[^'";\s]+)['"]?/g, (_, u) => `@import '${proxyUrl(u, baseUrl)}'`);
  return css;
}

app.get('/proxy', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send('Keine URL angegeben');

  // Cache prüfen
  const cached = cache.get(target);
  if (cached && Date.now() - cached.time < CACHE_TIME) {
    res.set('Content-Type', cached.contentType);
    res.set('X-Cache', 'HIT'); // zeigt dass Cache benutzt wurde
    return res.send(cached.data);
  }

  try {
    const response = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de,en;q=0.9',
        'Accept-Encoding': 'identity'
      },
      redirect: 'follow',
      // Timeout nach 10 Sekunden
      timeout: 10000
    });

    const contentType = response.headers.get('content-type') || '';

    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.set('Content-Type', contentType);
    // Browser soll auch cachen (1 Minute)
    res.set('Cache-Control', 'public, max-age=60');

    let data;

    if (contentType.includes('text/html')) {
      let html = await response.text();
      html = rewriteHtml(html, target);
      data = html;
    } else if (contentType.includes('text/css')) {
      let css = await response.text();
      css = rewriteCss(css, target);
      data = css;
    } else {
      data = await response.buffer();
    }

    // In Cache speichern (nur wenn nicht zu groß, max 1MB)
    if (Buffer.byteLength(typeof data === 'string' ? data : data) < 1024 * 1024) {
      cache.set(target, { data, contentType, time: Date.now() });
    }

    res.send(data);

  } catch (err) {
    res.status(500).send(`
      <html><body style="background:#111;color:#fff;font-family:monospace;padding:40px">
        <h2 style="color:#ff4060">Fehler beim Laden</h2>
        <p>${err.message}</p>
        <a href="/" style="color:#00e5ff">← Zurück</a>
      </body></html>
    `);
  }
});

// Cache alle 10 Minuten aufräumen
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of cache.entries()) {
    if (now - val.time > CACHE_TIME) cache.delete(key);
  }
}, 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy läuft auf Port ${PORT}`));
