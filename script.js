document.addEventListener("DOMContentLoaded", () => {
    console.log("script.js loaded ✔");

    // SAFE ELEMENT GETTER
    function get(id) {
        return document.getElementById(id) || null;
    }

    const priceElements = {
        bitcoin: get("btc-price"),
        ethereum: get("eth-price"),
        solana: get("sol-price"),
        binancecoin: get("bnb-price")
    };

    const fallback = {
        bitcoin: 65000,
        ethereum: 3400,
        solana: 150,
        binancecoin: 500
    };

    function safeUpdate(el, value) {
        if (!el) return;
        el.textContent = "$" + Number(value).toLocaleString();
    }

    async function loadPrices() {
        const url =
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin&vs_currencies=usd";

        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error("API failed");

            const data = await res.json();

            safeUpdate(priceElements.bitcoin, data.bitcoin.usd);
            safeUpdate(priceElements.ethereum, data.ethereum.usd);
            safeUpdate(priceElements.solana, data.solana.usd);
            safeUpdate(priceElements.binancecoin, data.binancecoin.usd);

        } catch (err) {
            console.warn("Using fallback prices:", err);

            safeUpdate(priceElements.bitcoin, fallback.bitcoin);
            safeUpdate(priceElements.ethereum, fallback.ethereum);
            safeUpdate(priceElements.solana, fallback.solana);
            safeUpdate(priceElements.binancecoin, fallback.binancecoin);
        }
    }

    loadPrices();
    setInterval(loadPrices, 30000);
});
