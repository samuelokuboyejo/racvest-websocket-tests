// Shared helpers for the Racvest realtime test pages.
// Needs sockjs-client and stompjs (2.3.3) loaded first. Leaflet is optional (only map pages).
(function () {
  const PAGES = [
    ['index.html', 'Start here'],
    ['delivery-flow.html', 'Delivery flow (both)'],
    ['courier-new-delivery-requests.html', 'Courier · new requests'],
    ['courier-all-events.html', 'Courier · all events'],
    ['courier-publish-location.html', 'Courier · publish location'],
    ['sender-delivery-request-events.html', 'Sender · request events'],
    ['sender-track-delivery.html', 'Sender · track delivery'],
    ['sender-nearby-couriers.html', 'Sender · nearby couriers'],
    ['chat.html', 'Chat (both)'],
  ];

  const VEHICLES = {
    MOTORCYCLE: { icon: '🏍️', color: '#00e5a0', label: 'Motorcycle' },
    TRICYCLE: { icon: '🛺', color: '#f5a623', label: 'Tricycle' },
    CAR: { icon: '🚗', color: '#4da3ff', label: 'Car' },
    MINI_VAN: { icon: '🚐', color: '#b388ff', label: 'Mini van' },
    VAN: { icon: '🚚', color: '#ff6b35', label: 'Van / bus' },
    WALKING_COURIER: { icon: '🚶', color: '#e8eaf0', label: 'Walking' },
    AIR_FREIGHT: { icon: '✈️', color: '#ff4d6d', label: 'Air freight' },
  };

  // ── Saved settings (per browser, only on this machine) ────────────────────
  const PREFIX = 'racvest-rt:';
  const store = {
    get(key) {
      try { return localStorage.getItem(PREFIX + key); } catch (e) { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(PREFIX + key, value); } catch (e) { /* storage blocked */ }
    },
    clear() {
      try {
        Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
      } catch (e) { /* storage blocked */ }
    },
  };

  // Any input with data-save="key" is restored on load and saved as you type.
  // Keys are shared between pages, so the server URL and tokens only need pasting once.
  function restoreFields() {
    document.querySelectorAll('[data-save]').forEach((el) => {
      const saved = store.get(el.dataset.save);
      if (saved !== null) {
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = saved === el.value;
        else el.value = saved;
      }
      const save = () => {
        if (el.type === 'radio') { if (el.checked) store.set(el.dataset.save, el.value); }
        else if (el.type === 'checkbox') store.set(el.dataset.save, el.checked ? el.value : '');
        else store.set(el.dataset.save, el.value.trim());
      };
      el.addEventListener('input', save);
      el.addEventListener('change', save);
    });
  }

  function renderNav() {
    const nav = document.getElementById('pages');
    if (!nav) return;
    const here = location.pathname.split('/').pop() || 'index.html';
    nav.innerHTML = PAGES.map(([file, name]) =>
      `<a href="${file}" class="${file === here ? 'current' : ''}">${name}</a>`).join('');
  }

  // ── Status pill and log strip ──────────────────────────────────────────────
  function setStatus(state, text) {
    const pill = document.getElementById('statusPill');
    if (!pill) return;
    pill.className = 'status-pill ' + (state || '');
    document.getElementById('statusText').textContent = text;
  }

  function log(message, isError = false) {
    const strip = document.getElementById('logStrip');
    if (!strip) return;
    strip.className = 'log-strip' + (isError ? ' err' : '');
    strip.innerHTML = `<span>${isError ? 'ERR' : 'SYS'}</span>${escapeHtml(message)}`;
    (isError ? console.error : console.log)('[racvest-rt]', message);
  }

  // ── STOMP connection to the realtime service ──────────────────────────────
  class Connection {
    // options.onStatus(state, text) and options.onLog(message, isError) let a page with two
    // connections (one per role) show each one's status separately. Defaults: header pill + log strip.
    constructor(options = {}) {
      this.status = options.onStatus || setStatus;
      this.log = options.onLog || log;
      this.client = null;
      this.subs = new Map();
      this.receipts = new Map();
      this.receiptSeq = 0;
      this.onDisconnect = null;
    }

    get connected() {
      return !!(this.client && this.client.connected);
    }

    connect(serverUrl, token) {
      return new Promise((resolve, reject) => {
        const base = (serverUrl || '').trim().replace(/\/$/, '');
        if (!base || !token) {
          reject(new Error('Fill in the server URL and the access token.'));
          return;
        }
        const wsUrl = base + '/ws';
        this.status('connecting', 'Connecting…');
        this.log(`Connecting to ${wsUrl} …`);
        let settled = false;
        try {
          const socket = new SockJS(wsUrl);
          this.client = Stomp.over(socket);
          this.client.debug = null;
          this.client.onreceipt = (frame) => {
            const id = frame.headers['receipt-id'];
            const done = this.receipts.get(id);
            if (done) { this.receipts.delete(id); done(); }
          };
          this.client.connect(
            { Authorization: 'Bearer ' + token.trim() },
            () => {
              settled = true;
              this.status('connected', 'Connected');
              this.log(`Connected to ${wsUrl}`);
              resolve();
            },
            (error) => {
              const reason = error && error.headers && error.headers.message ? error.headers.message : String(error);
              this.status('error', settled ? 'Disconnected' : 'Failed');
              this.log((settled ? 'Connection lost: ' : 'Connection failed: ') + reason, true);
              this.subs.clear();
              if (!settled) reject(new Error(reason));
              else if (this.onDisconnect) this.onDisconnect(reason);
            },
          );
        } catch (e) {
          this.status('error', 'Error');
          reject(e);
        }
      });
    }

    // handler(body, destination, rawFrame). body is parsed JSON when possible.
    subscribe(destination, handler) {
      if (!this.connected) throw new Error('Not connected');
      this.unsubscribe(destination);
      const sub = this.client.subscribe(destination, (frame) => {
        let body = frame.body;
        try { body = JSON.parse(frame.body); } catch (e) { /* keep text */ }
        handler(body, destination, frame);
      });
      this.subs.set(destination, sub);
      return sub;
    }

    unsubscribe(destination) {
      const sub = this.subs.get(destination);
      if (sub) {
        try { sub.unsubscribe(); } catch (e) { /* already gone */ }
        this.subs.delete(destination);
      }
    }

    // Resolves when the realtime service confirms it received the frame (STOMP RECEIPT).
    send(destination, body, timeoutMs = 5000) {
      if (!this.connected) return Promise.reject(new Error('Not connected'));
      const id = 'r-' + (++this.receiptSeq);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.receipts.delete(id);
          reject(new Error('No receipt from the server within ' + timeoutMs / 1000 + 's'));
        }, timeoutMs);
        this.receipts.set(id, () => { clearTimeout(timer); resolve(); });
        this.client.send(destination, { 'content-type': 'application/json', receipt: id }, JSON.stringify(body));
      });
    }

    disconnect() {
      return new Promise((resolve) => {
        if (!this.client) { resolve(); return; }
        const client = this.client;
        this.client = null;
        this.subs.clear();
        try {
          client.disconnect(() => resolve());
        } catch (e) {
          resolve();
        }
        setTimeout(resolve, 1000);
        this.status('', 'Disconnected');
        this.log('Disconnected.');
      });
    }
  }

  // ── Event feed ─────────────────────────────────────────────────────────────
  // feed.add({ type, channel, summary (html), body, tone: 'good'|'warn'|'bad', at })
  class Feed {
    constructor(container, { max = 200, emptyHtml = '' } = {}) {
      this.el = typeof container === 'string' ? document.getElementById(container) : container;
      this.max = max;
      this.emptyHtml = emptyHtml;
      this.items = [];
      this.filter = null;
      this.render();
    }

    add(item) {
      // Keep the caller's object so it can update tone/summary later and call render().
      if (!item.at) item.at = new Date();
      this.items.unshift(item);
      if (this.items.length > this.max) this.items.pop();
      this.render();
    }

    setFilter(predicate) {
      this.filter = predicate;
      this.render();
    }

    clear() {
      this.items = [];
      this.render();
    }

    render() {
      const visible = this.filter ? this.items.filter(this.filter) : this.items;
      if (visible.length === 0) {
        this.el.innerHTML = `<div class="feed-empty">${this.emptyHtml || 'No events yet.'}</div>`;
        return;
      }
      this.el.innerHTML = visible.map((item) => `
        <div class="event ${item.tone || ''}">
          <div class="event-head">
            <span class="event-type">${escapeHtml(item.type || 'MESSAGE')}</span>
            <span class="event-channel">${escapeHtml(item.channel || '')}</span>
            <span class="event-time">${time(item.at)}</span>
          </div>
          ${item.summary ? `<div class="event-summary">${item.summary}</div>` : ''}
          <details><summary>Raw message</summary><pre>${escapeHtml(pretty(item.body))}</pre></details>
        </div>`).join('');
    }
  }

  // ── Maps (Leaflet) ─────────────────────────────────────────────────────────
  function createMap(elementId, center = [6.5244, 3.3792], zoom = 13) {
    const map = L.map(elementId, { zoomControl: true }).setView(center, zoom);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    }).addTo(map);
    return map;
  }

  function pinIcon(emoji, color) {
    return L.divIcon({
      className: '',
      html: `<div class="pin" style="color:${color};background:${color}22">${emoji}</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
  }

  // ── Geo helpers ────────────────────────────────────────────────────────────
  function distanceMeters(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Moves `from` towards `to` by up to `meters`. Returns the new point.
  function moveTowards(from, to, meters) {
    const total = distanceMeters(from, to);
    if (total <= meters || total === 0) return { lat: to.lat, lng: to.lng };
    const f = meters / total;
    return { lat: from.lat + (to.lat - from.lat) * f, lng: from.lng + (to.lng - from.lng) * f };
  }

  function formatDistance(meters) {
    if (meters == null || Number.isNaN(meters)) return '—';
    return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
  }

  // ── Human summary of a racvest DeliveryEvent ({ type, deliveryId, payload, message }) ──
  const GOOD = ['BID_ACCEPTED', 'BID_AUTO_ACCEPTED', 'PAYMENT_SUCCESSFUL', 'PAYMENT_CONFIRMED', 'PAYMENT_HELD',
    'PAYMENT_COMPLETED', 'PAYMENT_RECEIVED', 'COMPLETED', 'SUBMISSION_ACCEPTED', 'COURIER_INVITE_ACCEPTED',
    'MATCHED_DELIVERY_OFFER', 'DELIVERY_LIVE', 'JOB_RESERVED', 'RESERVED_JOB_ACTIVATED'];
  const WARN = ['BID_PRICE_UPDATED', 'SENDER_PRICE_UPDATED', 'COUNTER_OFFER_SENT', 'PAYMENT_REQUIRED',
    'SCHEDULED_DELIVERY_MORNING', 'SCHEDULED_DELIVERY_ONE_HOUR'];
  const BAD = ['CANCELLED_BY_SENDER', 'CANCELLED_BY_COURIER', 'BID_CANCELLED', 'PAYMENT_REFUNDED',
    'MATCHING_EXHAUSTED', 'SUBMISSION_REJECTED', 'TRIP_CANCELLED', 'DELIVERY_EXPIRED', 'COURIER_NO_SHOW_EXPIRY',
    'SENDER_COURIER_NO_SHOW'];

  function describeEvent(body) {
    if (!body || typeof body !== 'object') {
      return { type: 'MESSAGE', summary: escapeHtml(String(body)), tone: '' };
    }
    const type = body.type || (body.latitude != null ? 'COURIER LOCATION' : 'MESSAGE');
    const p = body.payload && typeof body.payload === 'object' ? body.payload : {};
    const b = (text) => `<b>${escapeHtml(text)}</b>`;
    const parts = [];
    switch (type) {
      case 'DELIVERY_LIVE': {
        const d = p.delivery || p;
        parts.push(`New request ${b(money(d.offeredPrice))}`);
        if (d.pickupAddress) parts.push(`from ${b(d.pickupAddress)}`);
        if (d.dropoffAddress) parts.push(`to ${b(d.dropoffAddress)}`);
        if (p.senderName) parts.push(`by ${escapeHtml(p.senderName)}`);
        if (p.highPriority) parts.push('⚡ high priority');
        break;
      }
      case 'MATCHED_DELIVERY_OFFER':
        parts.push(`Auto-matched offer ${b(money(p.offeredPrice))}`);
        if (p.pickupAddress) parts.push(`from ${b(p.pickupAddress)}`);
        if (p.dropoffAddress) parts.push(`to ${b(p.dropoffAddress)}`);
        if (p.offerExpirySeconds) parts.push(`answer within ${p.offerExpirySeconds}s`);
        break;
      case 'BID_PLACED': {
        const bid = p.bid || p;
        parts.push(`${b(bid.name || 'Someone')} bid ${b(money(bid.offeredPrice))}`);
        if (bid.etaMinutes != null) parts.push(`ETA ${bid.etaMinutes} min`);
        if (bid.role) parts.push(`as ${escapeHtml(bid.role)}`);
        if (bid.avgRating != null) parts.push(`★ ${Number(bid.avgRating).toFixed(1)} (${bid.ratingsCount ?? 0})`);
        break;
      }
      case 'BID_PRICE_UPDATED':
        parts.push(`${b(p.courierName || 'Courier')} changed their bid ${escapeHtml(money(p.previousPrice))} → ${b(money(p.newOfferedPrice))}`);
        break;
      case 'SENDER_PRICE_UPDATED':
        parts.push(`Sender changed the price ${escapeHtml(money(p.previousPrice))} → ${b(money(p.newOfferedPrice))}`);
        break;
      case 'COURIER_VIEWING':
        parts.push(`${b(String(p.viewerCount ?? (p.viewers || []).length))} courier(s) viewing this request`);
        break;
      case 'TRACKING_UPDATE':
        parts.push(`Status is now ${b(p.trackingStatus || '?')}`);
        break;
      case 'COURIER LOCATION':
        parts.push(`${b(Number(body.latitude).toFixed(5) + ', ' + Number(body.longitude).toFixed(5))}`);
        if (body.etaText) parts.push(`ETA ${escapeHtml(body.etaText)}`);
        break;
      default:
        break;
    }
    if (!parts.length) {
      const text = body.message || (body.notification && (body.notification.body || body.notification.title));
      if (text) parts.push(escapeHtml(text));
    }
    if (body.deliveryId) parts.push(`<span style="color:var(--text3)">delivery ${escapeHtml(String(body.deliveryId).slice(0, 8))}…</span>`);
    const tone = GOOD.includes(type) ? 'good' : WARN.includes(type) ? 'warn' : BAD.includes(type) ? 'bad' : '';
    return { type, summary: parts.join(' · '), tone };
  }

  // ── Small utils ────────────────────────────────────────────────────────────
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function pretty(value) {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2); } catch (e) { return String(value); }
  }

  function time(date) {
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function money(value) {
    if (value == null || value === '') return '—';
    const n = Number(value);
    return Number.isNaN(n) ? String(value) : '₦' + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function value(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function isUuid(text) {
    return UUID_RE.test((text || '').trim());
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderNav();
    restoreFields();
    const clear = document.getElementById('clearSaved');
    if (clear) {
      clear.addEventListener('click', () => {
        store.clear();
        log('Saved settings cleared on this browser. Reload to start fresh.');
      });
    }
  });

  window.RT = {
    Connection, Feed, VEHICLES, store, setStatus, log, createMap, pinIcon, describeEvent,
    distanceMeters, moveTowards, formatDistance, escapeHtml, pretty, time, money, value, isUuid,
  };
})();
