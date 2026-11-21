(() => {
  'use strict';

  const config = window.CRYPTORA_CONFIG || {};
  const feeRate = Number(config.TRADING_FEE || 0.001);
  const API = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h';
  const $ = (selector) => document.querySelector(selector);

  let assets = [];
  let currentSide = 'Buy';
  let currentUser = null;
  let currentProfile = null;
  let walletBalance = null;
  let authMode = 'login';
  let marketTimer = null;
  let supabase = null;

  const money = (value) => '$' + Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 8
  });
  const compact = (value) => '$' + Intl.NumberFormat('en-US', {
    notation: 'compact', maximumFractionDigits: 2
  }).format(Number(value || 0));
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  function customAssets() {
    try {
      const parsed = JSON.parse(localStorage.getItem('cryptora_custom_assets') || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  function marketCap(asset) {
    return Number(asset.price || 0) * Number(asset.supply || 0);
  }

  function normalized(coin) {
    return {
      id: coin.id, name: coin.name,
      symbol: String(coin.symbol || '').toUpperCase(),
      price: Number(coin.current_price || coin.price || 0),
      supply: Number(coin.circulating_supply || coin.supply || 0),
      change: Number(coin.price_change_percentage_24h_in_currency ?? coin.price_change_percentage_24h ?? coin.change ?? 0),
      volume: Number(coin.total_volume || 0),
      logo: coin.image || coin.logo || ''
    };
  }

  function mergeAssets(live) {
    const custom = customAssets().map((coin) => ({
      id: 'custom-' + String(coin.symbol || '').toUpperCase(),
      name: String(coin.name || 'Custom asset'),
      symbol: String(coin.symbol || '').toUpperCase(),
      price: Number(coin.price || 0), supply: Number(coin.supply || 0),
      change: Number(coin.change || 0), volume: Number(coin.volume || 0),
      logo: String(coin.logo || ''), custom: true
    })).filter((coin) => coin.symbol && Number.isFinite(coin.price));
    const map = new Map(live.map((asset) => [asset.symbol, asset]));
    custom.forEach((asset) => map.set(asset.symbol, asset));
    return [...map.values()].sort((a, b) => marketCap(b) - marketCap(a)).slice(0, 100);
  }

  function coinLogo(asset) {
    const symbol = escapeHtml(asset.symbol || '?');
    const fallback = escapeHtml(symbol.charAt(0));
    const fallbackHtml = `<span class="coin-fallback" aria-hidden="true">${fallback}</span>`;
    if (!asset.logo) return fallbackHtml;
    return `<img class="coin-logo" src="${escapeHtml(asset.logo)}" alt="${symbol} logo" width="30" height="30" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'coin-fallback',textContent:'${fallback}'}))">`;
  }

  function setMessage(message, isError = false) {
    const node = $('#authMessage');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('error', isError);
  }

  function openAuth(mode) {
    authMode = mode;
    $('#authTitle').textContent = mode === 'register' ? 'Create your account' : 'Welcome back';
    $('#authSubtitle').textContent = mode === 'register'
      ? 'Register with your email address.'
      : 'Log in to your CRYPTORA account.';
    $('#authSubmit').textContent = mode === 'register' ? 'Create Account' : 'Log In';
    $('#authPassword').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
    $('#displayNameLabel').hidden = mode !== 'register';
    $('#authDisplayName').hidden = mode !== 'register';
    $('#authDisplayName').required = mode === 'register';
    $('#authSwitch').innerHTML = mode === 'register'
      ? 'Already have an account? <button type="button" id="switchAuth">Log in</button>'
      : 'New to CRYPTORA? <button type="button" id="switchAuth">Create an account</button>';
    $('#authModal').hidden = false;
    setMessage('');
    $('#authEmail').focus();
    $('#switchAuth').onclick = () => openAuth(mode === 'register' ? 'login' : 'register');
  }

  function closeAuth() {
    $('#authModal').hidden = true;
    $('#authForm').reset();
    setMessage('');
  }

  function updateAccountUI() {
    const loggedIn = Boolean(currentUser);
    const label = currentProfile?.display_name || currentUser?.email || 'Guest';
    $('#accountLabel').textContent = loggedIn ? label : 'Guest';
    $('#accountStatus').textContent = loggedIn ? 'Connected' : 'Guest';
    $('#accountHint').textContent = loggedIn ? 'Supabase account' : 'Log in to access your wallet';
    $('#loginBtn').hidden = loggedIn;
    $('#registerBtn').hidden = loggedIn;
    $('#logoutBtn').hidden = !loggedIn;
    $('#usdBalance').textContent = loggedIn ? money(walletBalance) : '—';
    $('#walletTotal').textContent = loggedIn ? money(walletBalance) : '—';
    $('#walletDescription').textContent = loggedIn
      ? 'Available USD balance from your Supabase wallet.'
      : 'Sign in to view your USD wallet balance.';
    $('#portfolio').textContent = loggedIn ? money(walletBalance) : '—';
    $('#portfolioStatus').textContent = loggedIn ? 'Wallet loaded' : 'Sign in to view wallet';
    $('#holdings').innerHTML = loggedIn
      ? '<div class="empty">No crypto holdings recorded yet.</div>'
      : '<div class="empty">Sign in to view holdings.</div>';
  }

  async function loadAccountData() {
    if (!supabase || !currentUser) {
      currentProfile = null;
      walletBalance = null;
      updateAccountUI();
      return;
    }
    const userId = currentUser.id;
    const [profileResult, walletResult] = await Promise.all([
      supabase.from('profiles').select('id,username,display_name,avatar_url').eq('id', userId).maybeSingle(),
      supabase.from('wallets').select('id,currency,balance').eq('user_id', userId).eq('currency', 'USD').maybeSingle()
    ]);
    if (profileResult.error) console.error('Profile load error:', profileResult.error);
    if (walletResult.error) console.error('Wallet load error:', walletResult.error);
    currentProfile = profileResult.data || null;
    walletBalance = walletResult.data ? Number(walletResult.data.balance) : null;
    updateAccountUI();
    if (!walletResult.data) {
      $('#walletDescription').textContent = 'No USD wallet record found. Please contact support; do not create or credit balances from the browser.';
    }
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    if (!supabase) return setMessage('Supabase is not configured. Check config.js.', true);
    const email = $('#authEmail').value.trim();
    const password = $('#authPassword').value;
    const displayName = $('#authDisplayName').value.trim();
    const submit = $('#authSubmit');
    submit.disabled = true;
    setMessage(authMode === 'register' ? 'Creating your account…' : 'Signing in…');
    try {
      if (authMode === 'register') {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: {
            data: { display_name: displayName },
            emailRedirectTo: window.location.origin
          }
        });
        if (error) throw error;
        if (data.session) {
          currentUser = data.user;
          await loadAccountData();
          closeAuth();
        } else {
          setMessage('Registration received. Check your email to confirm your account, then log in.');
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        currentUser = data.user;
        await loadAccountData();
        closeAuth();
      }
    } catch (error) {
      console.error('Authentication error:', error);
      setMessage(error.message || 'Authentication failed. Please try again.', true);
    } finally {
      submit.disabled = false;
    }
  }

  async function initializeAuth() {
    if (!window.supabase?.createClient) {
      console.error('Supabase JS library did not load.');
      setMessage('Supabase library failed to load. Check your internet connection.', true);
      return;
    }
    if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY ||
        config.SUPABASE_URL.includes('YOUR_') || config.SUPABASE_ANON_KEY.includes('YOUR_')) {
      console.error('Supabase URL or publishable key is missing in config.js.');
      return;
    }
    supabase = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const { data, error } = await supabase.auth.getSession();
    if (error) console.error('Session restore error:', error);
    currentUser = data?.session?.user || null;
    await loadAccountData();
    supabase.auth.onAuthStateChange((_event, session) => {
      currentUser = session?.user || null;
      // Avoid awaiting Supabase calls inside this callback; schedule account refresh.
      Promise.resolve().then(loadAccountData);
    });
  }

  function renderMarkets() {
    const query = ($('#search')?.value || '').toLowerCase();
    const list = assets.filter((asset) => (asset.name + ' ' + asset.symbol).toLowerCase().includes(query));
    $('#assetCount').textContent = assets.length;
    $('#marketRows').innerHTML = list.map((asset, index) => `
      <tr>
        <td>${index + 1}</td>
        <td><div class="asset-cell">${coinLogo(asset)}<div><span class="asset">${escapeHtml(asset.name)}</span><span class="symbol">${escapeHtml(asset.symbol)}${asset.custom ? ' · CRYPTORA' : ''}</span></div></div></td>
        <td>${money(asset.price)}</td>
        <td class="${asset.change >= 0 ? 'up' : 'down'}">${asset.change >= 0 ? '+' : ''}${asset.change.toFixed(2)}%</td>
        <td>${compact(marketCap(asset))}</td>
        <td>${compact(asset.volume)}</td>
        <td><button type="button" data-trade-symbol="${escapeHtml(asset.symbol)}">Trade →</button></td>
      </tr>`).join('') || '<tr><td colspan="7" class="empty">No matching assets.</td></tr>';
    $('#assetSelect').innerHTML = assets.map((asset) =>
      `<option value="${escapeHtml(asset.symbol)}">${escapeHtml(asset.symbol)} — ${escapeHtml(asset.name)}</option>`
    ).join('');
    updateTradePrice();
  }

  async function loadMarkets() {
    $('#marketRows').innerHTML = '<tr><td colspan="7" class="loading">Loading live market data…</td></tr>';
    try {
      const response = await fetch(API, { cache: 'no-store' });
      if (!response.ok) throw new Error('Market API returned ' + response.status);
      const data = await response.json();
      assets = mergeAssets(data.map(normalized));
      $('#lastUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      $('#dataNote').textContent = 'Live market prices loaded from CoinGecko. Prices are periodically refreshed, not streamed tick-by-tick.';
      renderMarkets();
    } catch (error) {
      console.error('Market loading error:', error);
      assets = mergeAssets([]);
      $('#lastUpdated').textContent = 'Live data unavailable';
      $('#dataNote').textContent = 'Live market data could not be reached. No simulated price fallback is used; try Refresh again.';
      renderMarkets();
    }
  }

  function updateTradePrice() {
    const asset = assets.find((item) => item.symbol === $('#assetSelect').value);
    $('#tradePrice').textContent = asset ? money(asset.price) : '—';
  }

  function updateTotals() {
    const amount = Number($('#tradeAmount').value || 0);
    const fee = amount > 0 ? amount * feeRate : 0;
    $('#fee').textContent = money(fee);
    $('#total').textContent = money(currentSide === 'Buy' ? amount + fee : Math.max(0, amount - fee));
  }

  function bindEvents() {
    $('#loginBtn').onclick = () => openAuth('login');
    $('#registerBtn').onclick = () => openAuth('register');
    $('#logoutBtn').onclick = async () => {
      if (!supabase) return;
      const { error } = await supabase.auth.signOut();
      if (error) alert(error.message);
      else {
        currentUser = null; currentProfile = null; walletBalance = null;
        updateAccountUI();
      }
    };
    $('#authClose').onclick = closeAuth;
    $('#authModal').addEventListener('click', (event) => {
      if (event.target === $('#authModal')) closeAuth();
    });
    $('#authForm').addEventListener('submit', handleAuthSubmit);
    $('#search').oninput = renderMarkets;
    $('#refreshBtn').onclick = loadMarkets;
    $('#assetSelect').onchange = updateTradePrice;
    $('#tradeAmount').oninput = updateTotals;
    $('#tradeBtn').disabled = true;
    $('#tradeBtn').textContent = 'Trading unavailable';
    $('#tradeBtn').onclick = () => alert('Buy/Sell is disabled until a secure server-side order engine is implemented. Your wallet balance cannot be safely changed from browser code.');
    $('#depositBtn').onclick = () => alert('Deposits are not enabled yet. No real funds should be sent to this demo website.');
    $('#withdrawBtn').onclick = () => alert('Withdrawals are not enabled yet. No blockchain transfers are connected.');
    $('#themeBtn').onclick = () => {
      document.body.classList.toggle('dark');
      localStorage.setItem('cryptora_theme', document.body.classList.contains('dark') ? 'dark' : 'light');
    };
    document.querySelectorAll('.trade-tab').forEach((button) => {
      button.onclick = () => {
        document.querySelectorAll('.trade-tab').forEach((item) => item.classList.remove('active'));
        button.classList.add('active');
        currentSide = button.dataset.side;
        updateTotals();
      };
    });
    $('#marketRows').addEventListener('click', (event) => {
      const button = event.target.closest('[data-trade-symbol]');
      if (!button) return;
      $('#assetSelect').value = button.dataset.tradeSymbol;
      updateTradePrice();
      location.hash = '#trade';
    });
  }

  function restoreTheme() {
    if (localStorage.getItem('cryptora_theme') === 'dark') document.body.classList.add('dark');
  }

  document.addEventListener('DOMContentLoaded', async () => {
    bindEvents();
    restoreTheme();
    updateAccountUI();
    await initializeAuth();
    await loadMarkets();
    marketTimer = window.setInterval(loadMarkets, 60000);
  });
})(); 
