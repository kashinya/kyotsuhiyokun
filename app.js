// 共通費用くん. Shared data lives in Firebase Realtime Database under groups/{group name}.
// The query (?g=group&n=name) decides which group and who; the hash (#history #settlements #settle) decides the screen.
import { computeSettlement, isUnsettled, ownPortions } from './settlement.js';

// ---- Constants -------------------------------------------------------------
const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
const STORE_KEY = 'kyotsuhiyokun.v1';            // { groupName: memberName }
const HINT_KEY = 'kyotsuhiyokun.v1.iosHintClosed'; // '1' once the home-screen hint was closed
const APP_NAME = '共通費用くん';
const MAX_AMOUNT = 9999999;
const MAX_MEMO = 50;
const MAX_GROUP = 30;
const MAX_NAME = 20;
const RECENT_COUNT = 5;
const OFFLINE_GRACE_MS = 3000; // do not flash "接続待ち" while the first connection is being made

// ---- Persistence -----------------------------------------------------------
function loadStore() {
  try {
    const o = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch (e) {
    return {};
  }
}
// Moves the group to the end (most recent). name === undefined keeps the saved name.
function remember(g, name) {
  const s = loadStore();
  const keep = typeof s[g] === 'string' ? s[g] : '';
  delete s[g];
  s[g] = name === undefined ? keep : name;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch (e) {
    // Storage blocked: the URL alone is enough.
  }
}
function hintClosed() {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch (e) {
    return false;
  }
}
function closeHint() {
  try {
    localStorage.setItem(HINT_KEY, '1');
  } catch (e) {
    // ignore
  }
}

// ---- Helpers ---------------------------------------------------------------
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtNum(n) {
  return Number(n).toLocaleString('ja-JP');
}
function fmtDiff(n) {
  if (n > 0) return `+${fmtNum(n)}`;
  if (n < 0) return `−${fmtNum(-n)}`;
  return '±0';
}
function diffClass(n) {
  return n > 0 ? 'plus' : n < 0 ? 'minus' : '';
}
function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function cmp(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function normGroup(s) {
  return String(s ?? '').normalize('NFKC').trim();
}
function groupError(g) {
  if (!g) return 'グループ名を入れてください。';
  if (g.length > MAX_GROUP) return `グループ名は${MAX_GROUP}文字以内にしてください。`;
  if (/[.#$[\]/\x00-\x1f\x7f]/.test(g)) return 'グループ名に . # $ [ ] / は使えません。';
  return '';
}
function normName(s) {
  return String(s ?? '').trim();
}
function nameError(n) {
  if (!n) return '名前を入れてください。';
  if (n.length > MAX_NAME) return `名前は${MAX_NAME}文字以内にしてください。`;
  return '';
}
function parseAmount(s) {
  const t = String(s ?? '').normalize('NFKC').replace(/[,\s]/g, '');
  if (!t) return { error: '金額を入れてください。' };
  if (!/^\d+$/.test(t)) return { error: `金額は1〜${fmtNum(MAX_AMOUNT)}の整数で入れてください。` };
  const n = Number(t);
  if (n < 1 || n > MAX_AMOUNT) return { error: `金額は1〜${fmtNum(MAX_AMOUNT)}の整数で入れてください。` };
  return { value: n };
}
function toArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (v && typeof v === 'object') return Object.values(v).filter(Boolean);
  return [];
}

// ---- URL -------------------------------------------------------------------
function readUrl() {
  const p = new URLSearchParams(location.search);
  return { rawG: p.get('g') ?? '', g: normGroup(p.get('g')), n: normName(p.get('n')) };
}
function groupUrl(g, n) {
  const p = new URLSearchParams();
  p.set('g', g);
  if (n) p.set('n', n);
  return `${location.pathname}?${p}`;
}
function entryUrl() {
  return location.pathname;
}
function hashView() {
  return location.hash.replace(/^#/, '');
}

// ---- Group data ------------------------------------------------------------
// Member order is join order (fixed), so tiles do not jump around.
function memberList(raw) {
  return Object.entries(raw || {})
    .filter(([, m]) => m && typeof m.name === 'string')
    .map(([id, m]) => ({ id, name: m.name, createdAt: Number(m.createdAt) || 0 }))
    .sort((a, b) => a.createdAt - b.createdAt || cmp(a.id, b.id));
}
function expenseList(raw) {
  return Object.entries(raw || {})
    .filter(([, e]) => e && typeof e === 'object')
    .map(([id, e]) => ({
      id,
      memberId: e.memberId ?? null,
      enteredBy: e.enteredBy ?? null,
      amount: Number(e.amount) || 0,
      own: e.own && typeof e.own === 'object' ? e.own : {},
      memo: typeof e.memo === 'string' ? e.memo : '',
      createdAt: Number(e.createdAt) || 0,
      deletedAt: e.deletedAt ?? null,
      settlementId: e.settlementId ?? null,
    }))
    .sort((a, b) => a.createdAt - b.createdAt || cmp(a.id, b.id));
}
// Settlement of the current period, straight from a raw group node (also used inside transactions).
function settleRaw(raw) {
  return computeSettlement(expenseList(raw.expenses), memberList(raw.members).map((m) => m.id));
}
function normalizeGroup(v) {
  if (!v || typeof v !== 'object') return null;
  const members = memberList(v.members);
  const expenses = expenseList(v.expenses);
  const settlements = Object.entries(v.settlements || {})
    .filter(([, s]) => s && typeof s === 'object')
    .map(([id, s]) => ({
      id,
      total: Number(s.total) || 0,
      ownTotal: Number(s.ownTotal) || 0,
      share: Number(s.share) || 0,
      memberCount: Number(s.memberCount) || 0,
      createdAt: Number(s.createdAt) || 0,
      members: s.members && typeof s.members === 'object' ? s.members : {},
      transfers: toArray(s.transfers),
    }))
    .sort((a, b) => a.createdAt - b.createdAt || cmp(a.id, b.id));
  settlements.forEach((s, i) => { s.no = i + 1; });
  return {
    name: typeof v.name === 'string' && v.name ? v.name : '',
    closedAt: v.closedAt ?? null,
    members,
    memberById: new Map(members.map((m) => [m.id, m])),
    expenses,
    settlements,
    current: computeSettlement(expenses, members.map((m) => m.id)),
  };
}

// ---- App state -------------------------------------------------------------
const state = {
  g: '',               // group key from ?g=
  n: '',               // member name from ?n=
  group: undefined,    // undefined: loading, null: missing, object: normalized data
  loadError: '',
  me: null,            // { id, name }
  picking: false,      // "あなた：kt" was tapped: choose again
  notFound: '',        // ?n= name that is not a member
  connected: false,
  everConnected: false,
  closeAfterSettle: false,
  busy: false,
};
let fb = null;         // Firebase database module + db instance
let subscribedTo = null;
let viewKey = '';
let rememberedKey = null;
const bootAt = Date.now();

const $app = document.getElementById('app');
const $home = document.getElementById('btn-home');
const $info = document.getElementById('topbar-info');

function groupRef(g = state.g) {
  return fb.ref(fb.db, `groups/${g}`);
}
function memberName(id) {
  return state.group?.memberById.get(id)?.name ?? '?';
}

// ---- Head: title, apple-* meta and a manifest generated for this URL (SPEC 3.7) ----
function setMeta(name, content) {
  let m = document.querySelector(`meta[name="${name}"]`);
  if (!m) {
    m = document.createElement('meta');
    m.name = name;
    document.head.appendChild(m);
  }
  if (m.content !== content) m.content = content;
}
function updateHead() {
  const title = state.g ? (state.group?.name || state.g) : APP_NAME;
  if (document.title !== title) document.title = title;
  setMeta('apple-mobile-web-app-capable', 'yes');
  setMeta('apple-mobile-web-app-title', title);
  // A data: manifest has no base URL, so every URL in it must be absolute.
  const dir = location.origin + location.pathname.replace(/[^/]*$/, '');
  const manifest = {
    name: title,
    short_name: title,
    lang: 'ja',
    start_url: location.origin + location.pathname + location.search,
    scope: dir,
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f4f5f7',
    theme_color: '#1f5fbf',
    icons: [
      { src: `${dir}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: `${dir}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
  const href = `data:application/manifest+json;charset=utf-8,${encodeURIComponent(JSON.stringify(manifest))}`;
  let link = document.querySelector('link[rel="manifest"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'manifest';
    document.head.appendChild(link);
  }
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}

// ---- Rendering helpers -----------------------------------------------------
// A view is rebuilt only when its key changes; data updates only refresh the parts that change,
// so a half-typed amount is never wiped by someone else's input.
function show(key, shell, update) {
  if (key !== viewKey) {
    viewKey = key;
    $app.innerHTML = shell;
    window.scrollTo(0, 0);
  }
  if (update) update();
}
function put(id, html) {
  const el = document.getElementById(id);
  if (el && el.__html !== html) {
    el.innerHTML = html;
    el.__html = html;
  }
}
function renderTop() {
  const offline = fb && !state.connected && (state.everConnected || Date.now() - bootAt > OFFLINE_GRACE_MS);
  const home = state.g ? (state.group?.name || state.g) : APP_NAME;
  if ($home.textContent !== home) $home.textContent = home;
  const me = state.me && state.group && !state.picking
    ? `<button class="topbar-me" type="button" data-top="pick">あなた：<b>${esc(state.me.name)}</b></button>`
    : '';
  const html = `${offline ? '<span class="offline">接続待ち</span>' : ''}${me}`;
  if ($info.__html !== html) {
    $info.innerHTML = html;
    $info.__html = html;
  }
}
function navigate(view) {
  history.pushState({ fromMain: true }, '', `${location.pathname}${location.search}#${view}`);
  route();
}
function goMain() {
  state.closeAfterSettle = false;
  state.picking = false;
  if (hashView() && history.state?.fromMain) {
    history.back(); // popstate re-routes
    return;
  }
  history.replaceState(null, '', location.pathname + location.search);
  route();
}

// ---- Router ----------------------------------------------------------------
function route() {
  const u = readUrl();
  state.g = u.g;
  state.n = u.n;
  updateHead();
  if (!state.g) {
    renderTop();
    return viewEntry();
  }
  const err = groupError(state.g);
  if (err) {
    renderTop();
    return viewMessage('bad-group', 'このURLは開けません', `${esc(err)}`);
  }
  subscribe(state.g);
  const grp = state.group;
  if (state.loadError) {
    renderTop();
    return viewMessage('load-error', 'データを読み込めませんでした', esc(state.loadError));
  }
  if (grp === undefined) {
    renderTop();
    return show('loading', '<p class="loading">読み込み中…</p>');
  }
  if (grp === null) {
    state.me = null;
    renderTop();
    return viewMissing();
  }

  // Who am I: ?n= wins; localStorage is only a fallback when ?n= is absent.
  let me = null;
  state.notFound = '';
  if (state.n) {
    me = grp.members.find((m) => m.name === state.n) || null;
    if (!me) state.notFound = state.n;
  } else {
    const saved = loadStore()[state.g];
    me = saved ? grp.members.find((m) => m.name === saved) || null : null;
    if (me) history.replaceState(history.state, '', groupUrl(state.g, me.name) + location.hash);
  }
  state.me = me;
  // Record the visit once per page (most recent first on the entry screen).
  const visit = `${state.g}
${me ? me.name : ''}`;
  if (rememberedKey !== visit) {
    rememberedKey = visit;
    remember(state.g, me ? me.name : undefined);
  }
  updateHead();
  renderTop();
  if (!me || state.picking) return viewPick();

  const v = hashView();
  if (v !== 'settle') state.closeAfterSettle = false;
  if (v === 'history') return viewHistory();
  if (v === 'settlements') return viewSettlements();
  if (v === 'settle') return viewSettle();
  return viewMain();
}

function subscribe(g) {
  if (subscribedTo === g) return;
  subscribedTo = g;
  state.group = undefined;
  state.loadError = '';
  fb.onValue(
    groupRef(g),
    (snap) => {
      state.group = normalizeGroup(snap.val());
      route();
    },
    (err) => {
      state.loadError = err?.message || String(err);
      route();
    }
  );
}

// ---- Views: setup / message ------------------------------------------------
function viewSetup() {
  show('setup', `
    <div class="card stack">
      <h2>firebase-config.js を設定してください</h2>
      <p>費用を共有する保存先（Firebase Realtime Database）がまだ設定されていません。</p>
      <ol class="steps">
        <li>Firebase コンソールでプロジェクトを作る</li>
        <li>Realtime Database を asia-southeast1（シンガポール）に作り、ルールを <code>database.rules.json</code> の内容に置き換える</li>
        <li>ウェブアプリを追加し、表示された設定値を <code>firebase-config.js</code> に貼る（<code>databaseURL</code> は必須）</li>
      </ol>
      <p class="muted">くわしい手順は README.md にあります。</p>
    </div>
  `);
}
function viewMessage(key, title, body) {
  show(key, `
    <div class="card stack">
      <h2>${esc(title)}</h2>
      <p>${body}</p>
      <a class="btn" href="${esc(entryUrl())}">入口へ</a>
    </div>
  `);
}

// ---- View: entry (no ?g=) --------------------------------------------------
function viewEntry() {
  const saved = Object.entries(loadStore()).filter(([g, n]) => g && typeof n === 'string').reverse();
  const list = saved.length
    ? `<ul class="list">${saved.map(([g, n]) => `<li><a class="linkish who" href="${esc(groupUrl(g, n))}"><b>${esc(g)}</b></a><span class="muted">${n ? esc(n) : '名前未定'}</span></li>`).join('')}</ul>`
    : '<p class="muted">まだありません。</p>';
  show('entry', `
    <form class="card stack" data-form="enter" novalidate autocomplete="off">
      <h2>グループに入る</h2>
      <p class="muted">旅行ごとにグループを作ります。みんなで同じグループ名を入れると、同じ帳簿を見られます。</p>
      <input type="text" id="e-group" maxlength="${MAX_GROUP}" placeholder="グループ名（例：パタヤ）" aria-label="グループ名" enterkeyhint="go">
      <p class="err" id="e-err"></p>
      <button class="btn primary" type="submit" id="e-go">入る</button>
    </form>
    <div class="card">
      <h2>この端末で開いたグループ</h2>
      ${list}
    </div>
  `);
}
async function enterGroup() {
  const input = document.getElementById('e-group');
  const raw = input.value.trim();
  const g = normGroup(raw);
  const err = groupError(g);
  put('e-err', esc(err));
  if (err) return;
  const btn = document.getElementById('e-go');
  btn.disabled = true;
  try {
    const snap = await fb.get(groupRef(g));
    if (!snap.exists()) {
      if (!confirm(`『${g}』はまだありません。新しく作りますか？`)) return;
      if (!(await createGroup(g, raw))) return;
    }
    location.assign(groupUrl(g, loadStore()[g] || ''));
  } catch (e) {
    put('e-err', esc(`通信できませんでした。（${e?.message || e}）`));
  } finally {
    btn.disabled = false;
  }
}
async function createGroup(g, displayName) {
  const now = Date.now();
  const name = displayName || g;
  const res = await fb.runTransaction(groupRef(g), (cur) => {
    if (cur !== null) return; // already exists: nothing to do
    return { name, createdAt: now };
  });
  return res.snapshot.exists();
}

// ---- View: group not found -------------------------------------------------
function viewMissing() {
  show(`missing:${state.g}`, `
    <div class="card stack">
      <h2>『${esc(state.g)}』はまだありません</h2>
      <p>新しく作りますか？</p>
      <p class="err" id="x-err"></p>
      <button class="btn primary" type="button" data-act="create">作る</button>
      <a class="btn" href="${esc(entryUrl())}">入口へ</a>
    </div>
  `);
}

// ---- View: choose who you are (?g= without a known name) -------------------
function viewPick() {
  const grp = state.group;
  const closed = grp.closedAt != null;
  const cancel = state.picking && state.me;
  show(`pick:${closed ? 1 : 0}:${cancel ? 1 : 0}`, `
    <h1>${esc(grp.name || state.g)}</h1>
    <div id="p-notice"></div>
    ${closed ? '<div class="banner">このグループは終了しています。履歴だけ見られます。</div>' : ''}
    <div class="card">
      <h2>だれとして入りますか</h2>
      <div class="names" id="p-names"></div>
    </div>
    ${closed ? '' : `
    <form class="card stack" data-form="newname" novalidate autocomplete="off">
      <h2>新しい名前で入る</h2>
      <input type="text" id="p-name" maxlength="${MAX_NAME}" placeholder="名前（例：kt）" aria-label="名前" enterkeyhint="go" value="${esc(state.notFound)}">
      <p class="err" id="p-err"></p>
      <button class="btn primary" type="submit" id="p-go">この名前で入る</button>
    </form>`}
    ${cancel ? '<button class="btn" type="button" data-act="cancel-pick">戻る</button>' : ''}
    <p class="footer-note"><a class="linkish" href="${esc(entryUrl())}">ほかのグループを開く</a></p>
  `, () => {
    const g = state.group;
    put('p-notice', state.notFound ? `<p class="notice ng">『${esc(state.notFound)}』は見つかりません。名前を選んでください。</p>` : '');
    put('p-names', g.members.length
      ? g.members.map((m) => `<button class="btn ${state.me?.id === m.id ? 'primary' : ''}" type="button" data-act="choose" data-id="${esc(m.id)}">${esc(m.name)}</button>`).join('')
      : '<p class="muted">まだだれもいません。</p>');
  });
}
function chooseMember(member) {
  history.replaceState(null, '', groupUrl(state.g, member.name));
  remember(state.g, member.name);
  state.picking = false;
  route();
}
async function addMember() {
  const name = normName(document.getElementById('p-name').value);
  const err = nameError(name);
  put('p-err', esc(err));
  if (err) return;
  const existing = state.group.members.find((m) => m.name === name);
  if (existing) {
    if (confirm(`『${name}』はもういます。${name} として入りますか？`)) chooseMember(existing);
    return;
  }
  const btn = document.getElementById('p-go');
  btn.disabled = true;
  const id = fb.push(fb.child(groupRef(), 'members')).key;
  const now = Date.now();
  try {
    const res = await fb.runTransaction(groupRef(), (cur) => {
      if (cur === null) return cur; // not cached yet: let the server answer
      if (cur.closedAt != null) return;
      if (memberList(cur.members).some((m) => m.name === name)) return;
      return { ...cur, members: { ...(cur.members || {}), [id]: { name, createdAt: now } } };
    });
    const members = memberList(res.snapshot.val()?.members);
    const m = members.find((x) => x.name === name);
    if (m) return chooseMember(m);
    put('p-err', esc(res.snapshot.exists() ? '名前を追加できませんでした。' : 'グループが見つかりません。'));
  } catch (e) {
    put('p-err', esc(`保存できませんでした。（${e?.message || e}）`));
  } finally {
    if (btn.isConnected) btn.disabled = false;
  }
}

// ---- View: main ------------------------------------------------------------
function isIosSafariBrowser() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && navigator.standalone === false && !/CriOS|FxiOS|EdgiOS/.test(ua);
}
function lastSettleLine(g) {
  const s = g.settlements[g.settlements.length - 1];
  if (!s) return '';
  const t = s.transfers.length
    ? s.transfers.map((x) => `${esc(memberName(x.from))} → ${esc(memberName(x.to))} ${fmtNum(x.amount)}`).join('、')
    : '送金なし';
  return `<a class="linkish" href="#settlements" data-nav="settlements">前回の精算（${fmtDate(s.createdAt)}）：${t}</a>`;
}
// "合計 1,200（個別 280）／ 一人 307": the own portions are not part of the equal split.
function totalsHtml(r) {
  const own = r.ownTotal ? `（個別 ${fmtNum(r.ownTotal)}）` : '';
  return `合計 <b>${fmtNum(r.total)}</b>${own} ／ 一人 <b>${fmtNum(r.share)}</b>`;
}
// Own portions of one expense as shown in lists, in member order: "うち kt 280".
function ownText(e) {
  const ids = new Set(state.group.members.map((m) => m.id));
  const parts = state.group.members
    .filter((m) => m.id in ownPortions(e, ids))
    .map((m) => `${esc(m.name)} ${fmtNum(e.own[m.id])}`);
  return parts.length ? `うち ${parts.join('、')}` : '';
}
// Member table for the settlement preview and history. The 個別 column appears only when used.
function statsTable(rows) {
  const withOwn = rows.some((p) => p.own);
  const head = `<th>名前</th><th>出した</th>${withOwn ? '<th>個別</th>' : ''}<th>差額</th>`;
  const body = rows.map((p) => `<tr><td>${esc(p.name)}</td><td>${fmtNum(p.paid)}</td>${withOwn ? `<td>${p.own ? fmtNum(p.own) : ''}</td>` : ''}<td class="${diffClass(p.balance)}">${fmtDiff(p.balance)}</td></tr>`).join('');
  return `<table class="stats"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
function expenseRow(e, canDelete) {
  const sub = [e.memo ? esc(e.memo) : '', ownText(e), e.enteredBy && e.enteredBy !== e.memberId ? `入力：${esc(memberName(e.enteredBy))}` : '']
    .filter(Boolean).join('　');
  let act = '';
  if (e.deletedAt != null) act = '<span class="tag">取消済</span>';
  else if (canDelete && e.settlementId == null) act = `<button class="linkish" type="button" data-act="del" data-id="${esc(e.id)}">取消</button>`;
  return `<li class="${e.deletedAt != null ? 'deleted' : ''}">
    <span class="when">${fmtDate(e.createdAt)}</span>
    <span class="who">${esc(memberName(e.memberId))}${sub ? ` <small>${sub}</small>` : ''}</span>
    <span class="amt">${fmtNum(e.amount)}</span>
    <span class="act">${act}</span>
  </li>`;
}
function viewMain() {
  const grp = state.group;
  const closed = grp.closedAt != null;
  const meId = state.me.id;
  show(`main:${meId}:${closed ? 1 : 0}`, `
    ${closed ? '<div class="banner" id="m-closed"></div>' : ''}
    <div class="tiles" id="m-tiles"></div>
    <p class="totals" id="m-totals"></p>
    <p class="last-settle" id="m-last"></p>
    ${closed ? '' : `
    <form class="card stack" data-form="expense" novalidate autocomplete="off">
      <input type="text" id="m-amount" class="amount-input" inputmode="numeric" placeholder="金額" aria-label="金額" enterkeyhint="done">
      <div class="entry-row">
        <label class="field"><span>出した人</span><select id="m-payer"></select></label>
        <label class="field"><span>メモ（任意）</span><input type="text" id="m-memo" maxlength="${MAX_MEMO}" placeholder="夕食など"></label>
      </div>
      <div class="own-rows" id="m-own"></div>
      <button class="linkish" type="button" data-act="own-add">＋ 個別の分（その人だけに付ける）</button>
      <p class="err" id="m-err"></p>
      <button class="btn primary big" type="submit">出した</button>
    </form>`}
    <div class="card">
      <h2>最近の費用</h2>
      <ul class="list" id="m-recent"></ul>
    </div>
    <div class="footer-links">
      <a class="linkish" href="#history" data-nav="history">費用履歴</a>
      <a class="linkish" href="#settlements" data-nav="settlements">精算履歴</a>
    </div>
    ${closed ? '' : '<button class="btn primary" type="button" id="m-settle" data-act="settle">精算する</button>'}
    <div id="m-hint"></div>
    <button class="btn small" type="button" data-act="copy" id="m-copy" style="margin-top:14px">共有リンクをコピー</button>
    ${closed ? '' : '<button class="linkish danger-link" type="button" data-act="close">このグループを終了</button>'}
    <p class="footer-note"><a class="linkish" href="${esc(entryUrl())}">ほかのグループを開く</a></p>
  `, updateMain);
}
function updateMain() {
  const g = state.group;
  const r = g.current;
  const meId = state.me.id;
  const closed = g.closedAt != null;
  if (closed) put('m-closed', `このグループは終了しました（${fmtDate(g.closedAt)}）。履歴は見られます。`);
  // Every tile uses the size that fits the longest amount, so the numbers line up.
  const amounts = g.members.map((m) => fmtNum(r.members[m.id]?.paid ?? 0));
  document.getElementById('m-tiles').style.setProperty('--len', Math.max(...amounts.map((a) => a.length)));
  put('m-tiles', g.members.map((m, i) => {
    const p = r.members[m.id] || { paid: 0, balance: 0 };
    return `<div class="tile ${m.id === meId ? 'me' : ''}">
      <div class="name">${esc(m.name)}</div>
      <div class="amount">${amounts[i]}</div>
      <div class="diff ${diffClass(p.balance)}">${fmtDiff(p.balance)}</div>
    </div>`;
  }).join(''));
  put('m-totals', totalsHtml(r));
  put('m-last', lastSettleLine(g));
  const recent = g.expenses.filter((e) => e.settlementId == null).slice(-RECENT_COUNT).reverse();
  put('m-recent', recent.length ? recent.map((e) => expenseRow(e, !closed)).join('') : '<li class="muted">まだありません。</li>');
  const settleBtn = document.getElementById('m-settle');
  if (settleBtn) settleBtn.disabled = r.count === 0;
  const sel = document.getElementById('m-payer');
  if (sel) {
    const opts = memberOptions();
    if (sel.__html !== opts) {
      const keep = sel.__html ? sel.value : meId;
      sel.innerHTML = opts;
      sel.__html = opts;
      sel.value = g.memberById.has(keep) ? keep : meId;
    }
  }
  for (const s of document.querySelectorAll('#m-own select')) {
    const opts = memberOptions();
    if (s.__html === opts) continue;
    const keep = s.value;
    s.innerHTML = opts;
    s.__html = opts;
    s.value = g.memberById.has(keep) ? keep : meId;
  }
  put('m-hint', !closed && isIosSafariBrowser() && !hintClosed()
    ? `<div class="notice row" style="margin-top:14px"><span style="flex:1">共有 → <b>ホーム画面に追加</b> で、このグループが 1 タップで開きます。</span><button class="linkish" type="button" data-act="hint-close" aria-label="閉じる">閉じる</button></div>`
    : '');
}
function memberOptions() {
  return state.group.members.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}${m.id === state.me.id ? '（自分）' : ''}</option>`).join('');
}
// One "個別の分" row: who it is charged to and how much. Defaults to me.
function addOwnRow() {
  const box = document.getElementById('m-own');
  const opts = memberOptions();
  const row = document.createElement('div');
  row.className = 'own-row';
  row.innerHTML = `<select aria-label="個別の分を付ける人">${opts}</select>
    <input type="text" inputmode="numeric" placeholder="個別の金額" aria-label="個別の金額">
    <button class="linkish" type="button" data-act="own-del" aria-label="この行を消す">×</button>`;
  const sel = row.querySelector('select');
  sel.__html = opts;
  sel.value = state.me.id;
  box.appendChild(row);
  row.querySelector('input').focus();
}
// Reads the own rows. Empty rows are skipped; the same member twice is added up.
function readOwnRows(amount) {
  const own = {};
  let sum = 0;
  for (const row of document.querySelectorAll('#m-own .own-row')) {
    const raw = row.querySelector('input').value;
    if (!String(raw).trim()) continue;
    const id = row.querySelector('select').value;
    if (!state.group.memberById.has(id)) return { error: '個別の分を付ける人を選んでください。' };
    const a = parseAmount(raw);
    if (a.error) return { error: `個別の分：${a.error}` };
    own[id] = (own[id] || 0) + a.value;
    sum += a.value;
  }
  if (sum > amount) return { error: '個別の分の合計が金額を超えています。' };
  return { value: own };
}
function addExpense() {
  const amountEl = document.getElementById('m-amount');
  const memoEl = document.getElementById('m-memo');
  const payerEl = document.getElementById('m-payer');
  const a = parseAmount(amountEl.value);
  const memo = memoEl.value.trim();
  let err = a.error || '';
  if (!err && memo.length > MAX_MEMO) err = `メモは${MAX_MEMO}文字以内にしてください。`;
  if (!err && !state.group.memberById.has(payerEl.value)) err = '出した人を選んでください。';
  const own = err ? {} : readOwnRows(a.value);
  if (!err && own.error) err = own.error;
  put('m-err', esc(err));
  if (err) return;
  const expense = {
    memberId: payerEl.value,
    enteredBy: state.me.id,
    amount: a.value,
    memo,
    createdAt: Date.now(),
  };
  if (Object.keys(own.value).length) expense.own = own.value;
  // push() applies locally at once (onValue redraws the tiles) and is sent when connected.
  fb.push(fb.child(groupRef(), 'expenses'), expense).catch((e) => alert(`保存できませんでした。（${e?.message || e}）`));
  amountEl.value = '';
  memoEl.value = '';
  payerEl.value = state.me.id;
  document.getElementById('m-own').replaceChildren();
}
async function deleteExpense(id) {
  const e = state.group.expenses.find((x) => x.id === id);
  if (!e) return;
  if (!confirm(`${memberName(e.memberId)} ${fmtNum(e.amount)}${e.memo ? `（${e.memo}）` : ''} を取り消しますか？`)) return;
  const now = Date.now();
  try {
    const res = await fb.runTransaction(fb.child(groupRef(), `expenses/${id}`), (cur) => {
      if (cur === null) return cur; // not cached yet: let the server answer
      if (cur.deletedAt != null || cur.settlementId != null) return;
      return { ...cur, deletedAt: now };
    });
    if (!res.committed) {
      const v = res.snapshot.val();
      alert(v?.settlementId != null ? '精算済みのため取り消せません。' : 'すでに取り消されています。');
    }
  } catch (err) {
    alert(`取り消せませんでした。（${err?.message || err}）`);
  }
}
async function copyShareLink() {
  const url = location.origin + groupUrl(state.g);
  const btn = document.getElementById('m-copy');
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = 'コピーしました';
    setTimeout(() => { if (btn.isConnected) btn.textContent = '共有リンクをコピー'; }, 2000);
  } catch (e) {
    prompt('このリンクをコピーして送ってください', url);
  }
}

// ---- View: settlement preview (#settle) ------------------------------------
function viewSettle() {
  show('settle', `
    <h1>精算</h1>
    <div id="s-body"></div>
  `, () => {
    const g = state.group;
    const r = g.current;
    if (state.busy) return put('s-body', '<p class="loading">精算中…</p>');
    if (g.closedAt != null) {
      return put('s-body', '<p class="notice">このグループは終了しています。</p><button class="btn" type="button" data-act="main">戻る</button>');
    }
    if (!r.count) {
      return put('s-body', '<p class="notice">精算する費用がありません。</p><button class="btn" type="button" data-act="main">戻る</button>');
    }
    const rows = g.members.map((m) => ({ name: m.name, ...r.members[m.id] }));
    put('s-body', `
      ${state.closeAfterSettle ? '<p class="notice">未精算の費用があるので、先に精算してからグループを終了します。</p>' : ''}
      <div class="card">
        <p class="totals" style="margin:0 0 8px">${totalsHtml(r)}（${r.memberCount}人）</p>
        ${statsTable(rows)}
      </div>
      <div class="card">
        <h2>送金</h2>
        ${transferList(r.transfers)}
      </div>
      <p class="err" id="s-err"></p>
      <div class="stack">
        <button class="btn primary big" type="button" data-act="settle-confirm">${state.closeAfterSettle ? '精算してグループを終了する' : 'この内容で精算する'}</button>
        <button class="btn" type="button" data-act="main">キャンセル</button>
      </div>
    `);
  });
}
function transferList(transfers) {
  if (!transfers.length) return '<p class="muted">送金はありません（全員同じ額です）。</p>';
  return `<ul class="transfers">${transfers.map((t) => `<li><span>${esc(memberName(t.from))} → ${esc(memberName(t.to))}</span><span class="amt">${fmtNum(t.amount)}</span></li>`).join('')}</ul>`;
}
async function confirmSettle() {
  const thenClose = state.closeAfterSettle;
  const sid = fb.push(fb.child(groupRef(), 'settlements')).key;
  const now = Date.now();
  state.busy = true;
  route();
  let msg = '';
  try {
    // Recomputed from the latest data inside the transaction; the preview numbers are not used.
    const res = await fb.runTransaction(groupRef(), (cur) => {
      if (cur === null) return cur; // not cached yet: let the server answer
      if (cur.closedAt != null) return;
      const r = settleRaw(cur);
      if (!r.count) return;
      const expenses = { ...cur.expenses };
      for (const id of r.expenseIds) expenses[id] = { ...expenses[id], settlementId: sid };
      const record = { total: r.total, share: r.share, memberCount: r.memberCount, createdAt: now, members: r.members, transfers: r.transfers };
      if (r.ownTotal) record.ownTotal = r.ownTotal;
      return { ...cur, expenses, settlements: { ...(cur.settlements || {}), [sid]: record } };
    });
    if (!res.committed) {
      const v = res.snapshot.val();
      msg = !v ? 'グループが見つかりません。' : v.closedAt != null ? 'このグループは終了しています。' : '精算する費用がありません（ほかの人が先に精算したかもしれません）。';
    } else if (thenClose) {
      msg = await closeGroup();
    }
  } catch (e) {
    msg = `精算できませんでした。（${e?.message || e}）`;
  }
  state.busy = false;
  if (msg) {
    route();
    alert(msg);
    return;
  }
  goMain();
}

// ---- Close the group -------------------------------------------------------
async function requestClose() {
  if (!confirm('このグループを終了しますか？\n終了すると、費用の入力・取消・精算はできなくなります。元に戻せません。')) return;
  if (state.group.current.count > 0) {
    state.closeAfterSettle = true;
    navigate('settle');
    return;
  }
  const msg = await closeGroup();
  if (msg) alert(msg);
}
// Returns an error message, or '' when closed.
async function closeGroup() {
  const now = Date.now();
  try {
    const res = await fb.runTransaction(groupRef(), (cur) => {
      if (cur === null) return cur; // not cached yet: let the server answer
      if (cur.closedAt != null) return;
      if (settleRaw(cur).count > 0) return;
      return { ...cur, closedAt: now };
    });
    if (res.committed) return '';
    const v = res.snapshot.val();
    if (v?.closedAt != null) return '';
    return v ? '未精算の費用が増えたため終了できませんでした。精算してからもう一度終了してください。' : 'グループが見つかりません。';
  } catch (e) {
    return `終了できませんでした。（${e?.message || e}）`;
  }
}

// ---- View: expense history (#history) --------------------------------------
function viewHistory() {
  show('history', `
    <h1>費用履歴</h1>
    <div id="h-body"></div>
    <button class="btn" type="button" data-act="main">戻る</button>
  `, () => {
    const g = state.group;
    const closed = g.closedAt != null;
    const byId = new Map(g.settlements.map((s) => [s.id, s]));
    // A deleted expense never gets a settlementId; it belongs to the period it was entered in.
    const periodOf = (e) => {
      if (e.settlementId != null && byId.has(e.settlementId)) return e.settlementId;
      if (e.settlementId == null && e.deletedAt == null) return null;
      const s = g.settlements.find((x) => x.createdAt >= e.createdAt);
      return s ? s.id : null;
    };
    const groups = new Map([[null, []], ...[...g.settlements].reverse().map((s) => [s.id, []])]);
    for (const e of g.expenses) groups.get(periodOf(e)).push(e);
    const cards = [...groups].filter(([, list]) => list.length).map(([sid, list]) => {
      const s = sid ? byId.get(sid) : null;
      const live = list.filter((e) => e.deletedAt == null);
      const sum = live.reduce((a, e) => a + e.amount, 0);
      const title = s ? `精算 #${s.no}（${fmtDate(s.createdAt)}）` : '未精算';
      return `<div class="card">
        <h2>${title}</h2>
        <ul class="list">${list.slice().reverse().map((e) => expenseRow(e, !closed)).join('')}</ul>
        <p class="subtotal">小計 <b>${fmtNum(sum)}</b>（${live.length}件）</p>
      </div>`;
    });
    put('h-body', cards.length ? cards.join('') : '<p class="muted">まだ費用がありません。</p>');
  });
}

// ---- View: settlement history (#settlements) -------------------------------
function viewSettlements() {
  show('settlements', `
    <h1>精算履歴</h1>
    <div id="t-body"></div>
    <button class="btn" type="button" data-act="main">戻る</button>
  `, () => {
    const g = state.group;
    const cards = [...g.settlements].reverse().map((s) => {
      const rows = Object.entries(s.members)
        .map(([id, p]) => ({ name: memberName(id), paid: Number(p?.paid) || 0, own: Number(p?.own) || 0, balance: Number(p?.balance) || 0, order: g.members.findIndex((m) => m.id === id) }))
        .sort((a, b) => a.order - b.order);
      return `<details class="card">
        <summary>
          <h2>精算 #${s.no}（${fmtDate(s.createdAt)}）</h2>
          <p class="totals" style="text-align:left">${totalsHtml(s)}（${s.memberCount}人）</p>
          ${transferList(s.transfers)}
          <span class="more">内訳を見る</span>
        </summary>
        <div style="margin-top:8px">${statsTable(rows)}</div>
      </details>`;
    });
    put('t-body', cards.length ? cards.join('') : '<p class="muted">まだ精算していません。</p>');
  });
}

// ---- Events ----------------------------------------------------------------
$app.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target.dataset.form;
  if (f === 'enter') enterGroup();
  else if (f === 'newname') addMember();
  else if (f === 'expense') addExpense();
});
$app.addEventListener('click', (ev) => {
  const nav = ev.target.closest('[data-nav]');
  if (nav) {
    ev.preventDefault();
    navigate(nav.dataset.nav);
    return;
  }
  const t = ev.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'main') goMain();
  else if (act === 'create') {
    createGroup(state.g, readUrl().rawG.trim()).then(
      (ok) => { if (!ok) put('x-err', '作れませんでした。'); },
      (e) => put('x-err', esc(`通信できませんでした。（${e?.message || e}）`))
    );
  } else if (act === 'choose') {
    const m = state.group.memberById.get(t.dataset.id);
    if (m) chooseMember(m);
  } else if (act === 'cancel-pick') goMain();
  else if (act === 'del') deleteExpense(t.dataset.id);
  else if (act === 'own-add') addOwnRow();
  else if (act === 'own-del') t.closest('.own-row')?.remove();
  else if (act === 'settle') {
    state.closeAfterSettle = false;
    navigate('settle');
  } else if (act === 'settle-confirm') confirmSettle();
  else if (act === 'close') requestClose();
  else if (act === 'copy') copyShareLink();
  else if (act === 'hint-close') {
    closeHint();
    put('m-hint', '');
  }
});
$info.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-top="pick"]')) {
    state.picking = true;
    route();
  }
});
$home.addEventListener('click', () => {
  if (!fb) return;
  if (state.g) goMain();
  else route();
});
window.addEventListener('popstate', () => {
  if (fb) route();
});

// ---- Boot ------------------------------------------------------------------
function configured(c) {
  return !!c && typeof c.databaseURL === 'string' && /^https:\/\/\S+$/.test(c.databaseURL.trim());
}
async function boot() {
  // Normalize ?g= (NFKC, trim) so that the URL, the DB key and the home-screen icon all agree.
  const u = readUrl();
  if (u.g && u.rawG !== u.g && !groupError(u.g)) history.replaceState(null, '', groupUrl(u.g, u.n) + location.hash);
  updateHead();

  let cfg = null;
  try {
    ({ firebaseConfig: cfg } = await import('./firebase-config.js'));
  } catch (e) {
    cfg = null;
  }
  if (!configured(cfg)) return viewSetup();
  try {
    const [appMod, dbMod] = await Promise.all([import(`${SDK}firebase-app.js`), import(`${SDK}firebase-database.js`)]);
    const app = appMod.initializeApp({ ...cfg, databaseURL: cfg.databaseURL.trim() });
    fb = { ...dbMod, db: dbMod.getDatabase(app) };
  } catch (e) {
    show('sdk-error', '<p>Firebase を読み込めませんでした。通信できる場所で開き直してください。</p>');
    return;
  }
  fb.onValue(fb.ref(fb.db, '.info/connected'), (snap) => {
    state.connected = snap.val() === true;
    if (state.connected) state.everConnected = true;
    renderTop();
  });
  setTimeout(renderTop, OFFLINE_GRACE_MS + 100);
  route();
}
boot();
