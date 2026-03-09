const express = require('express');
const fetch = require('node-fetch');
const app = express();

app.use(express.static('public'));

app.get('/proxy', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send('Keine URL');

  try {
    const response = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    let html = await response.text();

    html = html.replace(/href="(https?:\/\/[^"]+)"/g,
      (_, u) => `href="/proxy?url=${encodeURIComponent(u)}"`
    );

    res.send(html);
  } catch (err) {
    res.status(500).send('Fehler beim Laden der Seite: ' + err.message);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Proxy läuft!');
});
