// api/getCryptoPrice.js
export default async function handler(req, res) {
  try {
    const { coin = 'bitcoin', vs = 'usd' } = req.query
    const coinId = encodeURIComponent(coin)
    const vsId = encodeURIComponent(vs)
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=${vsId}`
    const r = await fetch(url)
    if (!r.ok) throw new Error('Price fetch failed')
    const json = await r.json()
    const price = json[coin] && json[coin][vs] ? json[coin][vs] : null
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60')
    return res.status(200).json({ price })
  } catch (err) {
    return res.status(500).json({ error: err.message || 'error' })
  }
}
