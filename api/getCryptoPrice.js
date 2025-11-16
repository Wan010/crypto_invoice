// api/getCryptoPrice.js
export default async function handler(req, res) {
  try {
    // Query string options (optional)
    // ?coins=bitcoin,ethereum&vs=usd
    const coinsParam = req.query.coins || 'bitcoin,ethereum';
    const vs = req.query.vs || 'usd';

    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinsParam)}&vs_currencies=${encodeURIComponent(vs)}`;
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });

    if (!r.ok) {
      const txt = await r.text();
      throw new Error('CoinGecko fetch failed: ' + txt);
    }
    const json = await r.json();

    // Build friendly output
    const out = {};
    const mapping = {
      bitcoin: 'btc',
      ethereum: 'eth',
      'usd-coin': 'usdc',
      tether: 'usdt',
      solana: 'sol'
    };

    Object.keys(json).forEach(key => {
      const short = mapping[key] || key;
      out[short] = json[key][vs];
    });

    // If usdt not present, set 1 (useful for conversions)
    if (out.usdt === undefined) out.usdt = 1;

    // Cache: short server-side cache to reduce calls (s-maxage)
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');

    return res.status(200).json(out);
  } catch (err) {
    console.error('/api/getCryptoPrice error', err);
    return res.status(500).json({ error: err.message || 'price error' });
  }
}
