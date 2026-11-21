(() => {
  'use strict';

  const config = window.CRYPTORA_CONFIG || {};
  const feeRate = Number(config.TRADING_FEE || 0.001);

  const API =
    'https://api.coingecko.com/api/v3/coins/markets' +
    '?vs_currency=usd' +
    '&order=market_cap_desc' +
    '&per_page=100' +
    '&page=1' +
    '&sparkline=false' +
    '&price_change_percentage=24h';

  const $ = (selector) => document.querySelector(selector);

  let assets = [];
  let currentSide = 'Buy';
  let currentUser = null;
  let currentProfile = null;
  let walletBalance = null;
  let authMode = 'login';
  let marketTimer = null;
  let supabase = null;

  const money = (value) =>
    '$' +
    Number(value || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8
    });

  const compact = (value) =>
    '$' +
    Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 2
    }).format(Number(value || 0));

  const escapeHtml = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));

  function customAssets() {
    try {
      const parsed = JSON.parse(
        localStorage.getItem('cryptora_custom_assets') || '[]'
      );

      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function marketCap(asset) {
    return (
      Number(asset.price || 0) *
      Number(asset.supply || 0)
    );
  }

  function normalized(coin) {
    return {
      id: coin.id,
      name: coin.name,

      symbol: String(
        coin.symbol || ''
      ).toUpperCase(),

      price: Number(
        coin.current_price ||
        coin.price ||
        0
      ),

      supply: Number(
        coin.circulating_supply ||
        coin.supply ||
        0
      ),

      change: Number(
        coin.price_change_percentage_24h_in_currency ??
        coin.price_change_percentage_24h ??
        coin.change ??
        0
      ),

      volume: Number(
        coin.total_volume || 0
      ),

      logo:
        coin.image ||
        coin.logo ||
        ''
    };
  }

  function mergeAssets(live) {
    const custom = customAssets()
      .map((coin) => ({
        id:
          'custom-' +
          String(
            coin.symbol || ''
          ).toUpperCase(),

        name:
          String(
            coin.name ||
            'Custom asset'
          ),

        symbol:
          String(
            coin.symbol || ''
          ).toUpperCase(),

        price:
          Number(
            coin.price || 0
          ),

        supply:
          Number(
            coin.supply || 0
          ),

        change:
          Number(
            coin.change || 0
          ),

        volume:
          Number(
            coin.volume || 0
          ),

        logo:
          String(
            coin.logo || ''
          ),

        custom: true
      }))
      .filter(
        (coin) =>
          coin.symbol &&
          Number.isFinite(
            coin.price
          )
      );

    const map =
      new Map(
        live.map(
          (asset) => [
            asset.symbol,
            asset
          ]
        )
      );

    custom.forEach(
      (asset) =>
        map.set(
          asset.symbol,
          asset
        )
    );

    return [
      ...map.values()
    ]
      .sort(
        (a, b) =>
          marketCap(b) -
          marketCap(a)
      )
      .slice(0, 100);
  }

  function coinLogo(asset) {
    const symbol =
      escapeHtml(
        asset.symbol || '?'
      );

    const fallback =
      escapeHtml(
        symbol.charAt(0)
      );

    const fallbackHtml =
      `<span class="coin-fallback" aria-hidden="true">${fallback}</span>`;

    if (!asset.logo) {
      return fallbackHtml;
    }

    return `
      <img
        class="coin-logo"
        src="${escapeHtml(asset.logo)}"
        alt="${symbol} logo"
        width="30"
        height="30"
        loading="lazy"
        referrerpolicy="no-referrer"
        onerror="this.style.display='none';"
      >
    `;
  }

  function setMessage(
    message,
    isError = false
  ) {
    const node =
      $('#authMessage');

    if (!node) return;

    node.textContent =
      message;

    node.classList.toggle(
      'error',
      isError
    );
  }

  function createAuthModal() {
    if ($('#authModal')) {
      return;
    }

    const modal =
      document.createElement('div');

    modal.id =
      'authModal';

    modal.hidden =
      true;

    modal.innerHTML = `
      <div class="auth-overlay">
        <div class="auth-card">

          <button
            type="button"
            id="authClose"
            class="auth-close"
            aria-label="Close"
          >
            ×
          </button>

          <div class="auth-brand">
            CRYPTORA
          </div>

          <h2 id="authTitle">
            Welcome back
          </h2>

          <p id="authSubtitle">
            Log in to your CRYPTORA account.
          </p>

          <div
            id="authMessage"
            class="auth-message"
          ></div>

          <form id="authForm">

            <label
              id="displayNameLabel"
              hidden
            >
              Display Name

              <input
                id="authDisplayName"
                type="text"
                autocomplete="name"
                placeholder="Your name"
                hidden
              >
            </label>

            <label>
              Email Address

              <input
                id="authEmail"
                type="email"
                autocomplete="email"
                placeholder="you@example.com"
                required
              >
            </label>

            <label>
              Password

              <input
                id="authPassword"
                type="password"
                autocomplete="current-password"
                placeholder="Password"
                minlength="6"
                required
              >
            </label>

            <button
              id="authSubmit"
              type="submit"
              class="auth-submit"
            >
              Log In
            </button>

          </form>

          <div
            id="authSwitch"
            class="auth-switch"
          >
            New to CRYPTORA?
            <button
              type="button"
              id="switchAuth"
            >
              Create an account
            </button>
          </div>

        </div>
      </div>
    `;

    document.body.appendChild(
      modal
    );

    const style =
      document.createElement('style');

    style.textContent = `
      #authModal {
        position: fixed;
        inset: 0;
        z-index: 99999;
      }

      #authModal[hidden] {
        display: none !important;
      }

      .auth-overlay {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: rgba(0, 0, 0, .65);
        backdrop-filter: blur(8px);
      }

      .auth-card {
        position: relative;
        width: 100%;
        max-width: 430px;
        padding: 32px;
        border-radius: 18px;
        background: #ffffff;
        color: #101828;
        box-shadow: 0 24px 80px rgba(0,0,0,.3);
      }

      body.dark .auth-card {
        background: #111827;
        color: #f8fafc;
      }

      .auth-close {
        position: absolute;
        top: 14px;
        right: 16px;
        border: 0;
        background: transparent;
        font-size: 28px;
        cursor: pointer;
        color: inherit;
      }

      .auth-brand {
        font-size: 22px;
        font-weight: 800;
        color: #2563eb;
        margin-bottom: 18px;
      }

      .auth-card h2 {
        margin: 0 0 8px;
        font-size: 26px;
      }

      .auth-card p {
        margin: 0 0 22px;
        opacity: .7;
      }

      .auth-card label {
        display: block;
        margin-bottom: 16px;
        font-size: 13px;
        font-weight: 600;
      }

      .auth-card input {
        display: block;
        width: 100%;
        box-sizing: border-box;
        margin-top: 7px;
        padding: 12px 14px;
        border: 1px solid #d0d5dd;
        border-radius: 9px;
        outline: none;
        font-size: 14px;
        background: #fff;
        color: #101828;
      }

      body.dark .auth-card input {
        background: #1f2937;
        border-color: #374151;
        color: #fff;
      }

      .auth-card input:focus {
        border-color: #2563eb;
        box-shadow: 0 0 0 3px rgba(37,99,235,.12);
      }

      .auth-submit {
        width: 100%;
        margin-top: 4px;
        padding: 12px;
        border: 0;
        border-radius: 9px;
        background: #2563eb;
        color: white;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
      }

      .auth-submit:hover {
        background: #1746b5;
      }

      .auth-submit:disabled {
        opacity: .6;
        cursor: not-allowed;
      }

      .auth-switch {
        margin-top: 20px;
        text-align: center;
        font-size: 13px;
        opacity: .75;
      }

      .auth-switch button {
        border: 0;
        background: transparent;
        color: #2563eb;
        font-weight: 700;
        cursor: pointer;
      }

      .auth-message {
        min-height: 20px;
        margin-bottom: 14px;
        font-size: 13px;
        color: #0e9f6e;
      }

      .auth-message.error {
        color: #dc3545;
      }

      .coin-logo {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        object-fit: contain;
        display: block;
      }

      .coin-fallback {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: #e7eaf0;
        color: #344054;
        font-size: 12px;
        font-weight: 800;
      }
    `;

    document.head.appendChild(
      style
    );
  }

  function openAuth(mode) {
    authMode =
      mode;

    createAuthModal();

    $('#authTitle').textContent =
      mode === 'register'
        ? 'Create your account'
        : 'Welcome back';

    $('#authSubtitle').textContent =
      mode === 'register'
        ? 'Register with your email address.'
        : 'Log in to your CRYPTORA account.';

    $('#authSubmit').textContent =
      mode === 'register'
        ? 'Create Account'
        : 'Log In';

    $('#authPassword').autocomplete =
      mode === 'register'
        ? 'new-password'
        : 'current-password';

    $('#displayNameLabel').hidden =
      mode !== 'register';

    $('#authDisplayName').hidden =
      mode !== 'register';

    $('#authDisplayName').required =
      mode === 'register';

    $('#authSwitch').innerHTML =
      mode === 'register'
        ? `
          Already have an account?
          <button type="button" id="switchAuth">
            Log in
          </button>
        `
        : `
          New to CRYPTORA?
          <button type="button" id="switchAuth">
            Create an account
          </button>
        `;

    $('#authModal').hidden =
      false;

    setMessage('');

    $('#authEmail').focus();

    $('#switchAuth').onclick =
      () =>
        openAuth(
          mode === 'register'
            ? 'login'
            : 'register'
        );
  }

  function closeAuth() {
    if (!$('#authModal')) {
      return;
    }

    $('#authModal').hidden =
      true;

    $('#authForm').reset();

    setMessage('');
  }

  function updateAccountUI() {
    const loggedIn =
      Boolean(currentUser);

    const label =
      currentProfile?.display_name ||
      currentUser?.email ||
      'Guest';

    if ($('#accountLabel')) {
      $('#accountLabel').textContent =
        loggedIn
          ? label
          : 'Guest';
    }

    if ($('#accountStatus')) {
      $('#accountStatus').textContent =
        loggedIn
          ? 'Connected'
          : 'Guest';
    }

    if ($('#accountHint')) {
      $('#accountHint').textContent =
        loggedIn
          ? 'Supabase account'
          : 'Log in to access your wallet';
    }

    if ($('#loginBtn')) {
      $('#loginBtn').hidden =
        loggedIn;
    }

    if ($('#registerBtn')) {
      $('#registerBtn').hidden =
        loggedIn;
    }

    if ($('#logoutBtn')) {
      $('#logoutBtn').hidden =
        !loggedIn;
    }

    if ($('#usdBalance')) {
      $('#usdBalance').textContent =
        loggedIn
          ? money(walletBalance)
          : '—';
    }

    if ($('#walletTotal')) {
      $('#walletTotal').textContent =
        loggedIn
          ? money(walletBalance)
          : '—';
    }

    if ($('#walletDescription')) {
      $('#walletDescription').textContent =
        loggedIn
          ? 'Available USD balance from your Supabase wallet.'
          : 'Sign in to view your USD wallet balance.';
    }

    if ($('#portfolio')) {
      $('#portfolio').textContent =
        loggedIn
          ? money(walletBalance)
          : '—';
    }

    if ($('#portfolioStatus')) {
      $('#portfolioStatus').textContent =
        loggedIn
          ? 'Wallet loaded'
          : 'Sign in to view wallet';
    }

    if ($('#holdings')) {
      $('#holdings').innerHTML =
        loggedIn
          ? '<div class="empty">No crypto holdings recorded yet.</div>'
          : '<div class="empty">Sign in to view holdings.</div>';
    }
  }

  async function loadAccountData() {
    if (
      !supabase ||
      !currentUser
    ) {
      currentProfile =
        null;

      walletBalance =
        null;

      updateAccountUI();

      return;
    }

    const userId =
      currentUser.id;

    const [
      profileResult,
      walletResult
    ] =
      await Promise.all([
        supabase
          .from('profiles')
          .select(
            'id,username,display_name,avatar_url'
          )
          .eq('id', userId)
          .maybeSingle(),

        supabase
          .from('wallets')
          .select(
            'id,currency,balance'
          )
          .eq('user_id', userId)
          .eq('currency', 'USD')
          .maybeSingle()
      ]);

    if (
      profileResult.error
    ) {
      console.error(
        'Profile load error:',
        profileResult.error
      );
    }

    if (
      walletResult.error
    ) {
      console.error(
        'Wallet load error:',
        walletResult.error
      );
    }

    currentProfile =
      profileResult.data ||
      null;

    walletBalance =
      walletResult.data
        ? Number(
            walletResult.data.balance
          )
        : null;

    updateAccountUI();

    if (
      !walletResult.data &&
      $('#walletDescription')
    ) {
      $('#walletDescription').textContent =
        'No USD wallet record found. Please contact support.';
    }
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();

    if (!supabase) {
      setMessage(
        'Supabase is not configured. Check config.js.',
        true
      );

      return;
    }

    const email =
      $('#authEmail').value.trim();

    const password =
      $('#authPassword').value;

    const displayName =
      $('#authDisplayName').value.trim();

    const submit =
      $('#authSubmit');

    submit.disabled =
      true;

    setMessage(
      authMode === 'register'
        ? 'Creating your account...'
        : 'Signing in...'
    );

    try {
      if (
        authMode === 'register'
      ) {
        const {
          data,
          error
        } =
          await supabase.auth.signUp({
            email,
            password,

            options: {
              data: {
                display_name:
                  displayName
              },

              emailRedirectTo:
                window.location.origin
            }
          });

        if (error) {
          throw error;
        }

        if (data.session) {
          currentUser =
            data.user;

          await loadAccountData();

          closeAuth();

          alert(
            'Account created successfully.'
          );
        } else {
          setMessage(
            'Registration successful. Please check your email and confirm your account.'
          );
        }
      } else {
        const {
          data,
          error
        } =
          await supabase.auth.signInWithPassword({
            email,
            password
          });

        if (error) {
          throw error;
        }

        currentUser =
          data.user;

        await loadAccountData();

        closeAuth();
      }
    } catch (error) {
      console.error(
        'Authentication error:',
        error
      );

      setMessage(
        error.message ||
        'Authentication failed. Please try again.',
        true
      );
    } finally {
      submit.disabled =
        false;
    }
  }

  async function initializeAuth() {
    createAuthModal();

    /*
      Load Supabase JS automatically if
      index.html does not already include it.
    */

    if (
      !window.supabase?.createClient
    ) {
      await new Promise(
        (resolve, reject) => {
          const script =
            document.createElement(
              'script'
            );

          script.src =
            'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

          script.onload =
            resolve;

          script.onerror =
            reject;

          document.head.appendChild(
            script
          );
        }
      );
    }

    if (
      !window.supabase?.createClient
    ) {
      setMessage(
        'Supabase library failed to load.',
        true
      );

      return;
    }

    if (
      !config.SUPABASE_URL ||
      !config.SUPABASE_ANON_KEY ||
      config.SUPABASE_URL.includes(
        'YOUR_'
      ) ||
      config.SUPABASE_ANON_KEY.includes(
        'YOUR_'
      )
    ) {
      console.error(
        'Supabase URL or publishable key is missing in config.js.'
      );

      return;
    }

    supabase =
      window.supabase.createClient(
        config.SUPABASE_URL,
        config.SUPABASE_ANON_KEY,
        {
          auth: {
            persistSession:
              true,

            autoRefreshToken:
              true,

            detectSessionInUrl:
              true
          }
        }
      );

    const {
      data,
      error
    } =
      await supabase.auth.getSession();

    if (error) {
      console.error(
        'Session restore error:',
        error
      );
    }

    currentUser =
      data?.session?.user ||
      null;

    await loadAccountData();

    supabase.auth.onAuthStateChange(
      (_event, session) => {
        currentUser =
          session?.user ||
          null;

        Promise.resolve()
          .then(
            loadAccountData
          );
      }
    );
  }

  function renderMarkets() {
    const query =
      (
        $('#search')?.value ||
        ''
      ).toLowerCase();

    const list =
      assets.filter(
        (asset) =>
          (
            asset.name +
            ' ' +
            asset.symbol
          )
            .toLowerCase()
            .includes(
              query
            )
      );

    if ($('#assetCount')) {
      $('#assetCount').textContent =
        assets.length;
    }

    if ($('#marketRows')) {
      $('#marketRows').innerHTML =
        list.map(
          (asset, index) => `
            <tr>
              <td>${index + 1}</td>

              <td>
                <div class="asset-cell">
                  ${coinLogo(asset)}

                  <div>
                    <span class="asset">
                      ${escapeHtml(asset.name)}
                    </span>

                    <span class="symbol">
                      ${escapeHtml(asset.symbol)}
                      ${
                        asset.custom
                          ? ' · CRYPTORA'
                          : ''
                      }
                    </span>
                  </div>
                </div>
              </td>

              <td>
                ${money(asset.price)}
              </td>

              <td class="${
                asset.change >= 0
                  ? 'up'
                  : 'down'
              }">
                ${
                  asset.change >= 0
                    ? '+'
                    : ''
                }${asset.change.toFixed(2)}%
              </td>

              <td>
                ${compact(
                  marketCap(asset)
                )}
              </td>

              <td>
                ${compact(
                  asset.volume
                )}
              </td>

              <td>
                <button
                  type="button"
                  data-trade-symbol="${escapeHtml(
                    asset.symbol
                  )}"
                >
                  Trade →
                </button>
              </td>
            </tr>
          `
        ).join('') ||
        `
          <tr>
            <td colspan="7" class="empty">
              No matching assets.
            </td>
          </tr>
        `;
    }

    if ($('#assetSelect')) {
      $('#assetSelect').innerHTML =
        assets.map(
          (asset) =>
            `
              <option value="${escapeHtml(
                asset.symbol
              )}">
                ${escapeHtml(
                  asset.symbol
                )} —
                ${escapeHtml(
                  asset.name
                )}
              </option>
            `
        ).join('');
    }

    updateTradePrice();
  }

  async function loadMarkets() {
    if ($('#marketRows')) {
      $('#marketRows').innerHTML =
        `
          <tr>
            <td
              colspan="7"
              class="loading"
            >
              Loading live market data...
            </td>
          </tr>
        `;
    }

    try {
      const response =
        await fetch(
          API,
          {
            cache:
              'no-store'
          }
        );

      if (!response.ok) {
        throw new Error(
          'Market API returned ' +
          response.status
        );
      }

      const data =
        await response.json();

      assets =
        mergeAssets(
          data.map(
            normalized
          )
        );

      if ($('#lastUpdated')) {
        $('#lastUpdated').textContent =
          'Updated ' +
          new Date().toLocaleTimeString(
            'en-US',
            {
              hour:
                '2-digit',

              minute:
                '2-digit'
            }
          );
      }

      if ($('#dataNote')) {
        $('#dataNote').textContent =
          'Live market prices loaded from CoinGecko. Prices are periodically refreshed, not streamed tick-by-tick.';
      }

      renderMarkets();
    } catch (error) {
      console.error(
        'Market loading error:',
        error
      );

      assets =
        mergeAssets([]);

      if ($('#lastUpdated')) {
        $('#lastUpdated').textContent =
          'Live data unavailable';
      }

      if ($('#dataNote')) {
        $('#dataNote').textContent =
          'Live market data could not be reached. Try Refresh again.';
      }

      renderMarkets();
    }
  }

  function updateTradePrice() {
    const select =
      $('#assetSelect');

    if (!select) {
      return;
    }

    const asset =
      assets.find(
        (item) =>
          item.symbol ===
          select.value
      );

    if ($('#tradePrice')) {
      $('#tradePrice').textContent =
        asset
          ? money(asset.price)
          : '—';
    }
  }

  function updateTotals() {
    const amount =
      Number(
        $('#tradeAmount')?.value ||
        0
      );

    const fee =
      amount > 0
        ? amount * feeRate
        : 0;

    if ($('#fee')) {
      $('#fee').textContent =
        money(fee);
    }

    if ($('#total')) {
      $('#total').textContent =
        money(
          currentSide === 'Buy'
            ? amount + fee
            : Math.max(
                0,
                amount - fee
              )
        );
    }
  }

  function bindEvents() {
    if ($('#loginBtn')) {
      $('#loginBtn').onclick =
        () =>
          openAuth(
            'login'
          );
    }

    if ($('#registerBtn')) {
      $('#registerBtn').onclick =
        () =>
          openAuth(
            'register'
          );
    }

    if ($('#logoutBtn')) {
      $('#logoutBtn').onclick =
        async () => {
          if (!supabase) {
            return;
          }

          const {
            error
          } =
            await supabase.auth.signOut();

          if (error) {
            alert(
              error.message
            );
          } else {
            currentUser =
              null;

            currentProfile =
              null;

            walletBalance =
              null;

            updateAccountUI();
          }
        };
    }

    createAuthModal();

    $('#authClose').onclick =
      closeAuth;

    $('#authModal').addEventListener(
      'click',
      (event) => {
        if (
          event.target ===
          $('#authModal')
        ) {
          closeAuth();
        }
      }
    );

    $('#authForm').addEventListener(
      'submit',
      handleAuthSubmit
    );

    if ($('#search')) {
      $('#search').oninput =
        renderMarkets;
    }

    if ($('#refreshBtn')) {
      $('#refreshBtn').onclick =
        loadMarkets;
    }

    if ($('#assetSelect')) {
      $('#assetSelect').onchange =
        updateTradePrice;
    }

    if ($('#tradeAmount')) {
      $('#tradeAmount').oninput =
        updateTotals;
    }

    if ($('#tradeBtn')) {
      $('#tradeBtn').disabled =
        true;

      $('#tradeBtn').textContent =
        'Trading unavailable';

      $('#tradeBtn').onclick =
        () =>
          alert(
            'Buy/Sell is disabled until a secure server-side order engine is implemented.'
          );
    }

    if ($('#depositBtn')) {
      $('#depositBtn').onclick =
        () =>
          alert(
            'Deposits are not enabled yet. No real funds should be sent to this demo website.'
          );
    }

    if ($('#withdrawBtn')) {
      $('#withdrawBtn').onclick =
        () =>
          alert(
            'Withdrawals are not enabled yet.'
          );
    }

    if ($('#themeBtn')) {
      $('#themeBtn').onclick =
        () => {
          document.body.classList.toggle(
            'dark'
          );

          localStorage.setItem(
            'cryptora_theme',
            document.body.classList.contains(
              'dark'
            )
              ? 'dark'
              : 'light'
          );
        };
    }

    document
      .querySelectorAll(
        '.trade-tab'
      )
      .forEach(
        (button) => {
          button.onclick =
            () => {
              document
                .querySelectorAll(
                  '.trade-tab'
                )
                .forEach(
                  (item) =>
                    item.classList.remove(
                      'active'
                    )
                );

              button.classList.add(
                'active'
              );

              currentSide =
                button.dataset.side;

              updateTotals();
            };
        }
      );

    if ($('#marketRows')) {
      $('#marketRows').addEventListener(
        'click',
        (event) => {
          const button =
            event.target.closest(
              '[data-trade-symbol]'
            );

          if (!button) {
            return;
          }

          if ($('#assetSelect')) {
            $('#assetSelect').value =
              button.dataset.tradeSymbol;

            updateTradePrice();
          }

          location.hash =
            '#trade';
        }
      );
    }
  }

  function restoreTheme() {
    if (
      localStorage.getItem(
        'cryptora_theme'
      ) === 'dark'
    ) {
      document.body.classList.add(
        'dark'
      );
    }
  }

  document.addEventListener(
    'DOMContentLoaded',
    async () => {
      bindEvents();

      restoreTheme();

      updateAccountUI();

      await initializeAuth();

      await loadMarkets();

      marketTimer =
        window.setInterval(
          loadMarkets,
          60000
        );
    }
  );
})();
