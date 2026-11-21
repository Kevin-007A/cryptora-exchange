
const feeRate = CRYPTORA_CONFIG.TRADING_FEE || 0.001;

let usd = 1000;
let coins = {};
let assets = [];
let orders = [];
let currentSide = 'Buy';
let marketTimer;

const API = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h';

const $ = s => document.querySelector(s);

const money = n => '$' + Number(n).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 8
});

const compact = n => '$' + Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2
}).format(Number(n || 0));


// CUSTOM ASSETS

function customAssets() {
  try {
    return JSON.parse(
      localStorage.getItem('cryptora_custom_assets') || '[]'
    );
  } catch {
    return [];
  }
}


// MARKET CAP

function marketCap(a) {
  return Number(a.price) * Number(a.supply || 0);
}


// NORMALIZE LIVE COINS

function normalized(c) {
  return {
    id: c.id,
    name: c.name,
    symbol: (c.symbol || '').toUpperCase(),
    price: Number(c.current_price || c.price || 0),
    supply: Number(c.circulating_supply || c.supply || 0),
    change: Number(
      c.price_change_percentage_24h_in_currency ??
      c.change ??
      0
    ),
    volume: Number(c.total_volume || 0),
    logo: c.image || c.logo || ''
  };
}


// MERGE LIVE + CUSTOM COINS

function mergeAssets(live) {
  const custom = customAssets().map(c => ({
    id: 'custom-' + c.symbol,
    name: c.name,
    symbol: String(c.symbol).toUpperCase(),
    price: Number(c.price),
    supply: Number(c.supply || 0),
    change: Number(c.change || 0),
    volume: Number(c.volume || 0),
    logo: c.logo || '',
    custom: true
  }));

  const map = new Map(
    live.map(a => [a.symbol, a])
  );

  custom.forEach(a => {
    map.set(a.symbol, a);
  });

  return [...map.values()]
    .sort((a, b) => marketCap(b) - marketCap(a))
    .slice(0, 100);
}


// COIN LOGO DISPLAY

function coinLogo(a) {
  const symbol = String(a.symbol || '?');
  const fallback = symbol.charAt(0);

  if (!a.logo) {
    return `
      <span style="
        width:30px;
        height:30px;
        min-width:30px;
        border-radius:50%;
        background:#26334a;
        color:#fff;
        display:grid;
        place-items:center;
        font-size:13px;
        font-weight:700;
      ">${fallback}</span>
    `;
  }

  return `
    <img
      src="${a.logo}"
      alt="${symbol} logo"
      width="30"
      height="30"
      loading="lazy"
      referrerpolicy="no-referrer"
      style="
        width:30px;
        height:30px;
        min-width:30px;
        border-radius:50%;
        object-fit:contain;
        background:#fff;
      "
      onerror="
        this.style.display='none';
        this.nextElementSibling.style.display='grid';
      "
    >

    <span style="
      display:none;
      width:30px;
      height:30px;
      min-width:30px;
      border-radius:50%;
      background:#26334a;
      color:#fff;
      place-items:center;
      font-size:13px;
      font-weight:700;
    ">${fallback}</span>
  `;
}


// RENDER EVERYTHING

function render() {
  const searchElement = $('#search');

  const q = (
    searchElement?.value || ''
  ).toLowerCase();

  const list = assets.filter(a =>
    (a.name + ' ' + a.symbol)
      .toLowerCase()
      .includes(q)
  );

  $('#assetCount').textContent = assets.length;

  // MARKET TABLE WITH COIN LOGOS

  $('#marketRows').innerHTML = list.map((a, i) => `
    <tr>

      <td>${i + 1}</td>

      <td>
        <div style="
          display:flex;
          align-items:center;
          gap:10px;
          min-width:150px;
        ">

          ${coinLogo(a)}

          <div style="
            display:flex;
            flex-direction:column;
            gap:3px;
          ">
            <span class="asset">${a.name}</span>

            <span class="symbol">
              ${a.symbol}${a.custom ? ' · CRYPTORA' : ''}
            </span>
          </div>

        </div>
      </td>

      <td>${money(a.price)}</td>

      <td class="${a.change >= 0 ? 'up' : 'down'}">
        ${a.change >= 0 ? '+' : ''}
        ${a.change.toFixed(2)}%
      </td>

      <td>${compact(marketCap(a))}</td>

      <td>${compact(a.volume)}</td>

      <td>
        <button onclick="selectAsset('${a.symbol}')">
          Trade →
        </button>
      </td>

    </tr>
  `).join('') || `
    <tr>
      <td colspan="7" class="empty">
        No matching assets.
      </td>
    </tr>
  `;


  // TRADE ASSET SELECT

  $('#assetSelect').innerHTML = assets.map(a => `
    <option value="${a.symbol}">
      ${a.symbol} — ${a.name}
    </option>
  `).join('');


  updateTradePrice();


  // USD BALANCE

  $('#usdBalance').textContent = money(usd);
  $('#walletTotal').textContent = money(usd);


  // PORTFOLIO VALUE

  let portfolio = usd + Object.entries(coins).reduce(
    (s, [sym, n]) => {
      const asset = assets.find(a => a.symbol === sym);

      return s + n * (asset?.price || 0);
    },
    0
  );

  $('#portfolio').textContent = money(portfolio);


  // CRYPTO HOLDINGS

  $('#holdings').innerHTML = Object.entries(coins)
    .filter(([s, n]) => n > 0)
    .map(([s, n]) => `
      <div class="holding">
        <span>${s}</span>
        <b>${Number(n).toFixed(8)}</b>
      </div>
    `).join('') || `
      <div class="empty">
        No crypto holdings yet.
      </div>
    `;


  // ORDER HISTORY

  $('#orderRows').innerHTML = orders.map(o => `
    <tr>
      <td>${o.time}</td>
      <td>${o.sym}</td>

      <td class="${o.side === 'Buy' ? 'up' : 'down'}">
        ${o.side}
      </td>

      <td>${money(o.amount)}</td>
      <td>${money(o.fee)}</td>
      <td>${o.status}</td>
    </tr>
  `).join('') || `
    <tr>
      <td colspan="6" class="empty">
        No orders yet.
      </td>
    </tr>
  `;
}


// UPDATE TRADE PRICE

function updateTradePrice() {
  const a = assets.find(
    x => x.symbol === $('#assetSelect').value
  );

  $('#tradePrice').textContent = a
    ? money(a.price)
    : '—';
}


// SELECT COIN TO TRADE

function selectAsset(s) {
  $('#assetSelect').value = s;

  updateTradePrice();

  location.hash = '#trade';
}


// LOAD LIVE MARKET DATA

async function loadMarkets() {
  $('#marketRows').innerHTML = `
    <tr>
      <td colspan="7" class="loading">
        Loading live market data…
      </td>
    </tr>
  `;

  try {
    const r = await fetch(API, {
      cache: 'no-store'
    });

    if (!r.ok) {
      throw new Error(
        'Market API returned ' + r.status
      );
    }

    const data = await r.json();

    assets = mergeAssets(
      data.map(normalized)
    );

    $('#lastUpdated').textContent =
      'Updated ' +
      new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });

    $('#dataNote').textContent =
      'Live market prices loaded directly from CoinGecko. No simulated price fallback is used.';

    render();

  } catch (e) {

    console.error('Market loading error:', e);

    assets = mergeAssets([]);

    $('#lastUpdated').textContent =
      'Live data unavailable';

    $('#dataNote').textContent =
      'Live market data could not be reached. Prices are not replaced with fake values; try Refresh again.';

    render();
  }
}


// SEARCH

$('#search').oninput = render;


// REFRESH BUTTON

$('#refreshBtn').onclick = loadMarkets;


// DARK / LIGHT MODE

$('#themeBtn').onclick = () => {

  document.body.classList.toggle('dark');

  localStorage.setItem(
    'cryptora_theme',
    document.body.classList.contains('dark')
      ? 'dark'
      : 'light'
  );

};


// BUY / SELL TABS

document.querySelectorAll('.trade-tab')
  .forEach(b => {

    b.onclick = () => {

      document.querySelectorAll('.trade-tab')
        .forEach(x => x.classList.remove('active'));

      b.classList.add('active');

      currentSide = b.dataset.side;

      $('#tradeBtn').textContent =
        currentSide === 'Buy'
          ? 'Place Test Buy Order'
          : 'Place Test Sell Order';

      updateTotals();
    };

  });


// ASSET SELECT CHANGE

$('#assetSelect').onchange = updateTradePrice;


// TRADE AMOUNT INPUT

$('#tradeAmount').oninput = updateTotals;


// FEE + TOTAL CALCULATION

function updateTotals() {

  const a = Number(
    $('#tradeAmount').value || 0
  );

  const fee = a * feeRate;

  $('#fee').textContent = money(fee);

  $('#total').textContent = money(
    currentSide === 'Buy'
      ? a + fee
      : a - fee
  );

}


// TEST BUY / SELL

$('#tradeBtn').onclick = () => {

  const sym = $('#assetSelect').value;

  const amount = Number(
    $('#tradeAmount').value || 0
  );

  const a = assets.find(
    x => x.symbol === sym
  );

  if (!a || amount <= 0 || !Number.isFinite(amount)) {
    return alert('Enter a valid USD amount.');
  }

  const fee = amount * feeRate;

  if (currentSide === 'Buy') {

    const total = amount + fee;

    if (usd < total) {
      return alert('Insufficient USD balance.');
    }

    usd -= total;

    coins[sym] = (coins[sym] || 0) +
      amount / a.price;

  } else {

    const qty = amount / a.price;

    if ((coins[sym] || 0) < qty) {
      return alert('Insufficient crypto balance.');
    }

    coins[sym] -= qty;

    usd += amount - fee;

  }

  orders.unshift({

    time: new Date().toLocaleString('en-US'),

    sym,

    side: currentSide,

    amount,

    fee,

    status: 'Filled'

  });

  $('#tradeMsg').textContent =
    `Test ${currentSide.toLowerCase()} filled at ${money(a.price)} per ${sym}.`;

  render();

};


// REGISTER

$('#registerBtn').onclick = () => {

  alert(
    'Registration will be connected to Supabase Auth.'
  );

};


// LOGIN

$('#loginBtn').onclick = () => {

  alert(
    'Login will be connected to Supabase Auth.'
  );

};


// DEPOSIT

$('#depositBtn').onclick = () => {

  alert(
    'Deposit: choose network → view admin-managed QR/address → submit request.'
  );

};


// WITHDRAW

$('#withdrawBtn').onclick = () => {

  alert(
    'Withdraw: choose network → upload receiving QR → enter address and amount → confirm. Processing time: 15–30 minutes.'
  );

};


// RESTORE SAVED THEME

if (
  localStorage.getItem('cryptora_theme') === 'dark'
) {
  document.body.classList.add('dark');
}


// INITIALIZE

$('#tradeBtn').textContent =
  'Place Test Buy Order';

loadMarkets();


// AUTO REFRESH EVERY 60 SECONDS

marketTimer = setInterval(
  loadMarkets,
  60000
);
