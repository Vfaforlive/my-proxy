const express = require('express');
const fetch = require('node-fetch');
const app = express();

app.use(express.static('public'));

// Hilfsfunktion: relative URLs zu absoluten machen
function toAbsolute(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return null;
  }
}

// Hilfsfunktion: URL durch Proxy leiten
function proxyUrl(url, base) {
  try {
    const absolute = toAbsolute(url, base);
    if (!absolute) return url;
    if (absolute.startsWith('data:')) return url; // data: URLs nicht anfassen
    return '/proxy?url=' + encodeURIComponent(absolute);
  } catch {
    return url;
  }
}

// Alle URLs im HTML umschreiben
function rewriteHtml(html, baseUrl) {
  // href=" ... "
  html = html.replace(/href="([^"]+)"/g, (_, u) => `href="${proxyUrl(u, baseUrl)}"`);
  html = html.replace(/href='([^']+)'/g, (_, u) => `href='${proxyUrl(u, baseUrl)}'`);

  // src=" ... "
  html = html.replace(/src="([^"]+)"/g, (_, u) => `src="${proxyUrl(u, baseUrl)}"`);
  html = html.replace(/src='([^']+)'/g, (_, u) => `src='${proxyUrl(u, baseUrl)}'`);

  // srcset=" ... "
  html = html.replace(/srcset="([^"]+)"/g, (_, srcset) => {
    const rewritten = srcset.replace(/(https?:\/\/[^\s,]+)/g, u => proxyUrl(u, baseUrl));
    return `srcset="${rewritten}"`;
  });

  // action=" ... " (Forms)
  html = html.replace(/action="([^"]+)"/g, (_, u) => `action="${proxyUrl(u, baseUrl)}"`);

  // url( ... ) in inline styles
  html = html.replace(/url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/g, (_, u) => `url(${proxyUrl(u, baseUrl)})`);

  // @import in style tags
  html = html.replace(/@import\s+['"]?(https?:\/\/[^'";\s]+)['"]?/g, (_, u) => `@import '${proxyUrl(u, baseUrl)}'`);

  // Meta refresh
  html = html.replace(/content="0;url=([^"]+)"/g, (_, u) => `content="0;url=${proxyUrl(u, baseUrl)}"`);

  // Base tag entfernen (würde Proxy-URLs kaputt machen)
  html = html.replace(/<base[^>]*>/gi, '');

  // Inject script um JS-Fetches abzufangen
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

// CSS umschreiben
function rewriteCss(css, baseUrl) {
  css = css.replace(/url\(['"]?((?!data:)[^'")\s]+)['"]?\)/g, (_, u) => {
    return `url(${proxyUrl(u, baseUrl)})`;
  });
  css = css.replace(/@import\s+['"]?(https?:\/\/[^'";\s]+)['"]?/g, (_, u) => {
    return `@import '${proxyUrl(u, baseUrl)}'`;
  });
  return css;
}

// Haupt-Proxy Route
app.get('/proxy', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send('Keine URL angegeben');

  try {
    const response = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de,en;q=0.9',
        'Accept-Encoding': 'identity'
      },
      redirect: 'follow'
    });

    const contentType = response.headers.get('content-type') || '';

    // Security headers entfernen die Proxy blockieren würden
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.set('Content-Type', contentType);

    if (contentType.includes('text/html')) {
      let html = await response.text();
      html = rewriteHtml(html, target);
      res.send(html);

    } else if (contentType.includes('text/css')) {
      let css = await response.text();
      css = rewriteCss(css, target);
      res.send(css);

    } else {
      // Alles andere (Bilder, Fonts, JS etc.) direkt durchleiten
      const buffer = await response.buffer();
      res.send(buffer);
    }

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy läuft auf Port ${PORT}`));
