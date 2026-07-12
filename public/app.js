'use strict';

// ---- 定数 / localStorage ----
const DEFAULT_CATEGORIES = [
  '食費', '交通費', '日用品費', '交際費', '趣味・娯楽',
  '水道光熱費', '通信費', '住居費', '医療費', '衣服・美容', 'その他'
];
const LS = {
  theme: 'keihi.theme',
  categories: 'keihi.categories',
  shortcuts: 'keihi.shortcuts',
  fixed: 'keihi.fixed'
};
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;   // 入力上限（圧縮前）。実送信は圧縮後で軽くなる
const IMAGE_MAX_EDGE = 1600;                 // 圧縮後の長辺(px)。レシートOCRに十分
const IMAGE_QUALITY = 0.8;                   // JPEG品質

function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
  catch { return fallback; }
}
// 破損値や別型で起動時にクラッシュしないよう、配列を期待する項目はガードする
function loadArray(key, fallback) {
  const v = load(key, fallback);
  return Array.isArray(v) ? v : fallback.slice();
}
function save(key, val) {
  // iOSプライベートモード等で setItem が例外を投げてもクラッシュさせない
  try { localStorage.setItem(key, JSON.stringify(val)); }
  catch { toast('設定を保存できませんでした（ブラウザのストレージ制限の可能性）'); }
}

let categories = loadArray(LS.categories, DEFAULT_CATEGORIES.slice());
let shortcuts = loadArray(LS.shortcuts, ['交際費', '会議費']);
let fixed = loadArray(LS.fixed, []);

// ---- DOM ----
const $ = (id) => document.getElementById(id);
const messagesEl = $('messages');
const inputEl = $('input');
const composerEl = $('composer');
const sendBtn = $('send-btn');
const fileInput = $('file-input');
const attachPreview = $('attach-preview');
const attachThumb = $('attach-thumb');
const ledgerEl = $('ledger');

let pendingImage = null; // { base64, mimeType, dataUrl }

// ---- テーマ ----
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
}
applyTheme(load(LS.theme, 'auto'));
$('btn-theme').addEventListener('click', () => {
  const cur = load(LS.theme, 'auto');
  const next = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
  save(LS.theme, next); applyTheme(next);
  toast(next === 'auto' ? 'テーマ: 自動' : next === 'light' ? 'テーマ: ライト' : 'テーマ: ダーク');
});

// ---- Toast ----
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// ---- メッセージ描画 ----
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function scrollDown() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
  // モバイルは messages が内側スクロールしない（max-height:none）ため、
  // 最後の子をビューポート内へスクロールして新着が画面外に出ないようにする
  if (messagesEl.scrollHeight <= messagesEl.clientHeight + 1) {
    messagesEl.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }
}

function addUserMessage(text, imageUrl) {
  const wrap = document.createElement('div');
  wrap.className = 'msg user';
  const img = imageUrl ? `<img src="${imageUrl}" alt="添付画像" />` : '';
  wrap.innerHTML = `<div class="avatar">🙂</div><div class="bubble">${escapeHtml(text || '(画像)')}${img}</div>`;
  messagesEl.appendChild(wrap); scrollDown();
}

function addBotBubble(html) {
  const wrap = document.createElement('div');
  wrap.className = 'msg bot';
  wrap.innerHTML = `<div class="avatar">🧾</div><div class="bubble">${html}</div>`;
  messagesEl.appendChild(wrap); scrollDown();
  return wrap;
}

// 確認カード
function addConfirmCard(data) {
  const wrap = document.createElement('div');
  wrap.className = 'msg bot';
  const card = document.createElement('div');
  card.className = 'card';
  wrap.innerHTML = `<div class="avatar">🧾</div>`;
  wrap.appendChild(card);
  messagesEl.appendChild(wrap);

  let current = { ...data };

  function renderCard() {
    const invalidAmount = !(Number(current.amount) > 0);
    card.innerHTML = `
      <h4>この内容で記帳しますか？</h4>
      <div class="card-row"><span class="k">日付</span><span class="v">${escapeHtml(current.date)}</span></div>
      <div class="card-row"><span class="k">金額</span><span class="v amount${invalidAmount ? ' warn' : ''}">${Number(current.amount).toLocaleString()}円</span></div>
      <div class="card-row"><span class="k">勘定科目</span><span class="v">${escapeHtml(current.category)}</span></div>
      <div class="card-row"><span class="k">支払先</span><span class="v">${escapeHtml(current.payee || 'なし')}</span></div>
      <div class="card-row"><span class="k">備考</span><span class="v">${escapeHtml(current.notes || 'なし')}</span></div>
      ${invalidAmount ? '<p class="card-note">⚠️ 金額を読み取れませんでした。「修正する」で入力してください。</p>' : ''}
      <div class="card-actions">
        <button class="btn btn-success" data-act="record"${invalidAmount ? ' disabled' : ''}>記帳する</button>
        <button class="btn btn-primary" data-act="edit">修正する</button>
        <button class="btn btn-secondary" data-act="cancel">キャンセル</button>
      </div>
      ${shortcuts.length ? `<div class="card-shortcuts">${shortcuts.map(s => `<button class="chip-btn" data-sc="${escapeHtml(s)}">🏷️ ${escapeHtml(s)}</button>`).join('')}</div>` : ''}
    `;
    if (!invalidAmount) card.querySelector('[data-act="record"]').addEventListener('click', onRecord);
    card.querySelector('[data-act="edit"]').addEventListener('click', onEdit);
    card.querySelector('[data-act="cancel"]').addEventListener('click', onCancel);
    card.querySelectorAll('[data-sc]').forEach(b =>
      b.addEventListener('click', () => { current.category = b.dataset.sc; renderCard(); refocusCard('[data-act="edit"]'); })
    );
  }
  // 設定ドロワーの科目/ショートカット変更をこのカードへ反映するためのフック
  card.__rerender = renderCard;

  // innerHTML 差し替えでフォーカスが body に落ちるのを防ぎ、同等ボタンへ戻す
  function refocusCard(sel) {
    const t = card.querySelector(sel);
    if (t && t.focus) t.focus();
  }

  function finalize(html) {
    card.classList.add('done');
    card.innerHTML = html;
    card.tabIndex = -1;
    card.focus(); // 押下ボタンが破棄されるため、結果カード自体へフォーカスを移す
  }

  async function onRecord() {
    card.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      const res = await fetch('/api/record', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: current })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || '記帳に失敗しました。');
      finalize(`
        <h4>✅ 記帳しました！</h4>
        <div class="card-row"><span class="k">日付</span><span class="v">${escapeHtml(current.date)}</span></div>
        <div class="card-row"><span class="k">金額</span><span class="v amount">${Number(current.amount).toLocaleString()}円</span></div>
        <div class="card-row"><span class="k">勘定科目</span><span class="v">${escapeHtml(current.category)}</span></div>
        <div class="status-line">スプレッドシートに追記しました。→ みんなの記帳に反映</div>
      `);
      loadLedger();
      toast('記帳しました！');
    } catch (e) {
      renderCard();
      refocusCard('[data-act="record"]');
      toast('⚠️ ' + e.message);
    }
  }

  function onEdit() { openEditModal(current, (updated) => { current = updated; renderCard(); refocusCard('[data-act="edit"]'); }); }
  function onCancel() { finalize('<h4>🚫 記帳をキャンセルしました。</h4>'); }

  renderCard();
  scrollDown();
}

// ---- ダイアログ共通: 背景を inert 化してフォーカストラップ ----
function setBackgroundInert(on) {
  ['app-header', 'demo-notice', 'app-main'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert'); }
  });
}
// 復帰先が既にDOMから外れている場合はスキップ
function restoreFocus(el) { if (el && el.isConnected && el.focus) el.focus(); }

// ---- 修正モーダル ----
let modalSave = null;
let lastFocusedModal = null;
function openEditModal(data, onSave) {
  lastFocusedModal = document.activeElement;
  $('edit-date').value = data.date;
  $('edit-amount').value = data.amount;
  $('edit-category').value = data.category;
  $('edit-payee').value = data.payee || '';
  $('edit-notes').value = data.notes || '';
  refreshCatDatalist();
  modalSave = onSave;
  $('edit-modal').hidden = false;
  setBackgroundInert(true);
  $('edit-date').focus();
}
function closeEditModal() {
  $('edit-modal').hidden = true; modalSave = null;
  setBackgroundInert(false);
  restoreFocus(lastFocusedModal);
}
$('edit-cancel').addEventListener('click', closeEditModal);
$('edit-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = parseInt(String($('edit-amount').value).replace(/[^0-9]/g, ''), 10);
  if (!Number.isFinite(amount) || amount <= 0) { toast('⚠️ 金額は1以上の数字で入力してください。'); return; }
  const date = $('edit-date').value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('⚠️ 日付は YYYY-MM-DD 形式で。'); return; }
  const updated = {
    date, amount,
    category: $('edit-category').value.trim() || '未分類',
    payee: $('edit-payee').value.trim(),
    notes: $('edit-notes').value.trim()
  };
  // コールバックを退避 → 先に閉じてから反映（renderCard で復帰先が破棄される問題を回避）
  const cb = modalSave;
  closeEditModal();
  if (cb) cb(updated);
});
$('edit-modal').addEventListener('click', (e) => { if (e.target.id === 'edit-modal') closeEditModal(); });

function refreshCatDatalist() {
  $('cat-list').innerHTML = categories.map(c => `<option value="${escapeHtml(c)}">`).join('');
}

// ---- 送信 ----
let sending = false;  // 再入防止（Enter/例チップ/ボタンの並行送信を一元ガード）

function setSendingState(on) {
  sending = on;
  sendBtn.disabled = on;
  document.querySelectorAll('.example-chip').forEach(b => { b.disabled = on; });
}

async function handleSend() {
  if (sending) return;
  const text = inputEl.value.trim();
  if (!text && !pendingImage) return;

  addUserMessage(text, pendingImage ? pendingImage.dataUrl : null);
  const imgForReq = pendingImage;
  inputEl.value = ''; autoGrow();
  clearAttachment();
  setSendingState(true);

  const thinking = addBotBubble('🔄 内容を確認しています…');

  try {
    const res = await fetch('/api/extract', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        imageBase64: imgForReq ? imgForReq.base64 : undefined,
        mimeType: imgForReq ? imgForReq.mimeType : undefined,
        categories
      })
    });
    const body = await res.json();
    thinking.remove();
    if (!res.ok) {
      addBotBubble('❌ ' + escapeHtml(body.error || 'エラーが発生しました。'));
      restoreDraft(text, imgForReq);
    }
    else { addConfirmCard(body.data); }
  } catch (e) {
    thinking.remove();
    addBotBubble('❌ 通信エラーが発生しました。');
    restoreDraft(text, imgForReq);
  } finally {
    setSendingState(false);
  }
}

// 失敗時に下書きを戻す。ただし待機中にユーザーが打ち直し/添付し直していれば上書きしない。
function restoreDraft(text, imgForReq) {
  if (!inputEl.value.trim() && text) { inputEl.value = text; autoGrow(); }
  if (imgForReq && !pendingImage) { pendingImage = imgForReq; attachThumb.src = imgForReq.dataUrl; attachPreview.hidden = false; }
}
composerEl.addEventListener('submit', (e) => { e.preventDefault(); handleSend(); });
inputEl.addEventListener('keydown', (e) => {
  // IME変換中(isComposing/keyCode 229)のEnterは無視し、確定後のEnterでのみ送信
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); handleSend(); }
});

// textarea 自動リサイズ
function autoGrow() { inputEl.style.height = 'auto'; inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px'; }
inputEl.addEventListener('input', autoGrow);

// ---- 画像添付 ----
// canvas でリサイズ・JPEG再圧縮してから送る。スマホの数MB写真がそのままだと
// Vercel Edge のリクエストボディ上限(約4MB)を超えて失敗するため、事前に縮小する。
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas unsupported')); return; }
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', IMAGE_QUALITY);
      const base64 = dataUrl.split(',')[1];
      if (!base64) { reject(new Error('encode failed')); return; }
      resolve({ base64, mimeType: 'image/jpeg', dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}

async function setImageFromFile(file) {
  if (!file || !file.type.startsWith('image/')) { toast('⚠️ 画像ファイルを選んでください。'); return; }
  if (file.size > MAX_IMAGE_BYTES) { toast('⚠️ 画像が大きすぎます（上限10MB）。'); return; }
  try {
    pendingImage = await compressImage(file);
    attachThumb.src = pendingImage.dataUrl;
    attachPreview.hidden = false;
  } catch {
    toast('⚠️ 画像を読み込めませんでした。');
  }
}
function clearAttachment() { pendingImage = null; attachPreview.hidden = true; attachThumb.src = ''; fileInput.value = ''; }
fileInput.addEventListener('change', (e) => setImageFromFile(e.target.files[0]));
$('attach-remove').addEventListener('click', clearAttachment);
// モーダル/ドロワー表示中は貼り付け/ドロップの画像添付を無視する
function overlayOpen() { return !$('edit-modal').hidden || !$('settings-drawer').hidden; }
document.addEventListener('paste', (e) => {
  if (overlayOpen()) return;
  const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (item) setImageFromFile(item.getAsFile());
});
['dragover', 'drop'].forEach(ev => document.addEventListener(ev, (e) => e.preventDefault()));
document.addEventListener('drop', (e) => {
  if (overlayOpen()) return;
  const f = e.dataTransfer?.files?.[0];
  if (f) setImageFromFile(f);
});

// ---- ライブ台帳 ----
let lastLedgerKey = '';
let lastLedgerSig = '';   // 全行のシグネチャ（無変更なら再描画しない）
let ledgerSeq = 0;        // 連番で古いレスポンスの描画を破棄
async function loadLedger() {
  const seq = ++ledgerSeq;
  try {
    const res = await fetch('/api/recent');
    const body = await res.json();
    if (seq !== ledgerSeq) return; // より新しい取得が走っていれば破棄
    // 取得失敗（error あり）と正常な空を区別する
    if (body.error) { ledgerEl.innerHTML = '<p class="ledger-empty">台帳の取得に失敗しました。時間をおいて再度お試しください。</p>'; lastLedgerSig = ''; return; }
    const rows = body.rows || [];
    if (rows.length === 0) { ledgerEl.innerHTML = '<p class="ledger-empty">まだ記帳がありません。<br>経費を送るとここに反映されます。</p>'; lastLedgerSig = ''; return; }
    const sig = JSON.stringify(rows);
    if (sig === lastLedgerSig) return; // 内容不変なら DOM を触らない
    const firstKey = rows[0].date + rows[0].amount + rows[0].stamp;
    ledgerEl.innerHTML = rows.map((r, i) => `
      <div class="ledger-row ${i === 0 && firstKey !== lastLedgerKey && lastLedgerKey ? 'fresh' : ''}">
        <div class="lr-top"><span class="lr-cat">${escapeHtml(r.category || '—')}</span><span class="lr-amt">${escapeHtml(r.amount)}円</span></div>
        <div class="lr-sub"><span>${escapeHtml(r.payee || r.notes || '')}</span><span>${escapeHtml(r.date)}</span></div>
      </div>`).join('');
    lastLedgerKey = firstKey;
    lastLedgerSig = sig;
  } catch {
    if (seq === ledgerSeq) { ledgerEl.innerHTML = '<p class="ledger-empty">台帳の取得に失敗しました。</p>'; lastLedgerSig = ''; }
  }
}
$('btn-refresh').addEventListener('click', async () => {
  const b = $('btn-refresh');
  b.disabled = true; b.classList.add('spinning');
  try { await loadLedger(); } finally { b.disabled = false; b.classList.remove('spinning'); }
});
setInterval(loadLedger, 20000);

// ---- 設定ドロワー ----
let lastFocusedDrawer = null;
function openSettings() {
  lastFocusedDrawer = document.activeElement;
  renderSettings();
  $('settings-drawer').hidden = false;
  setBackgroundInert(true);
  $('settings-close').focus();
}
function closeSettings() {
  $('settings-drawer').hidden = true;
  setBackgroundInert(false);
  restoreFocus(lastFocusedDrawer);
  // 設定変更（科目/ショートカット）を、表示中の未確定カードに反映する
  document.querySelectorAll('.card:not(.done)').forEach(c => { if (c.__rerender) c.__rerender(); });
}
$('btn-settings').addEventListener('click', openSettings);
$('settings-close').addEventListener('click', closeSettings);
$('settings-drawer').addEventListener('click', (e) => { if (e.target.id === 'settings-drawer') closeSettings(); });

// Escでモーダル/ドロワーを閉じる（モーダル優先）
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('edit-modal').hidden) { closeEditModal(); }
  else if (!$('settings-drawer').hidden) { closeSettings(); }
});

function renderSettings() { renderCategoryChips(); renderShortcutChips(); renderFixedList(); refreshCatDatalist(); }

function renderCategoryChips() {
  const el = $('category-chips');
  // 空でも壊れて見せない: 初期科目に戻すボタンを出す
  if (categories.length === 0) {
    el.innerHTML = '<p class="setting-help">科目が空です。</p><button id="cat-reset" class="ghost-btn small">初期科目に戻す</button>';
    $('cat-reset').addEventListener('click', () => {
      categories = DEFAULT_CATEGORIES.slice(); save(LS.categories, categories); renderSettings();
    });
    return;
  }
  el.innerHTML = categories.map(c =>
    `<span class="chip">${escapeHtml(c)}<button data-c="${escapeHtml(c)}" aria-label="${escapeHtml(c)}を削除" title="削除">✕</button></span>`).join('');
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    categories = categories.filter(x => x !== b.dataset.c); save(LS.categories, categories); renderSettings();
  }));
}
$('category-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('category-input').value.trim();
  if (v && !categories.includes(v)) { categories.push(v); save(LS.categories, categories); }
  $('category-input').value = ''; renderSettings();
});

function renderShortcutChips() {
  const el = $('shortcut-chips');
  if (shortcuts.length === 0) {
    el.innerHTML = '<p class="setting-help">未登録です。下の欄から追加できます。</p>';
    return;
  }
  el.innerHTML = shortcuts.map(c =>
    `<span class="chip">${escapeHtml(c)}<button data-s="${escapeHtml(c)}" aria-label="${escapeHtml(c)}を削除" title="削除">✕</button></span>`).join('');
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    shortcuts = shortcuts.filter(x => x !== b.dataset.s); save(LS.shortcuts, shortcuts); renderSettings();
  }));
}
$('shortcut-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('shortcut-input').value.trim();
  if (v && !shortcuts.includes(v)) { shortcuts.push(v); save(LS.shortcuts, shortcuts); }
  $('shortcut-input').value = ''; renderSettings();
});

function renderFixedList() {
  const el = $('fixed-list');
  if (fixed.length === 0) { el.innerHTML = '<p class="setting-help">まだ登録がありません。</p>'; return; }
  el.innerHTML = fixed.map((f, i) =>
    `<div class="fixed-item"><span>${escapeHtml(f.category)} — ${Number(f.amount).toLocaleString()}円 ${f.payee ? '(' + escapeHtml(f.payee) + ')' : ''}</span><button data-i="${i}" title="削除">✕</button></div>`).join('');
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    fixed.splice(Number(b.dataset.i), 1); save(LS.fixed, fixed); renderSettings();
  }));
}
$('fixed-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = parseInt(String($('fixed-amount').value).replace(/[^0-9]/g, ''), 10);
  const category = $('fixed-category').value.trim();
  const payee = $('fixed-payee').value.trim();
  if (!Number.isFinite(amount) || amount <= 0) { toast('⚠️ 金額は1以上で。'); return; }
  if (!category) { toast('⚠️ 科目を入力してください。'); return; }
  fixed.push({ amount, category, payee, notes: '固定費' });
  save(LS.fixed, fixed);
  $('fixed-amount').value = ''; $('fixed-category').value = ''; $('fixed-payee').value = '';
  renderSettings();
});
$('fixed-run').addEventListener('click', async () => {
  if (fixed.length === 0) { toast('固定費が登録されていません。'); return; }
  $('fixed-run').disabled = true;
  try {
    const res = await fetch('/api/fixed/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: fixed })
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || '記帳に失敗しました。');
    toast(`🗓️ ${body.count}件の固定費を記帳しました！`);
    loadLedger();
  } catch (e) {
    toast('⚠️ ' + e.message);
  } finally {
    $('fixed-run').disabled = false;
  }
});

// ---- 初期挨拶＋使い方＋ワンタップ例 ----
const EXAMPLES = [
  '🍙 コンビニ おにぎり 250円',
  '☕ スタバ ラテ 620円',
  '🚕 タクシー 1200円'
];

function renderExamples() {
  addBotBubble(
    'こんにちは！このデモは <b>①送る → ②AIが読み取る → ③確認して記帳</b> の3ステップです 🧾<br>' +
    'レシート画像や「コンビニ 500円」のような一言を下の欄に入力するか、<b>まずは下の例をタップ</b>してみてください👇'
  );
  const wrap = document.createElement('div');
  wrap.className = 'msg bot';
  wrap.innerHTML = '<div class="avatar">🧾</div>';
  const chips = document.createElement('div');
  chips.className = 'example-chips';
  EXAMPLES.forEach((label) => {
    const btn = document.createElement('button');
    btn.className = 'example-chip';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      // 絵文字ラベルを外して本文だけ送信し、そのまま抽出まで自動実行
      inputEl.value = label.replace(/^\S+\s/, '');
      handleSend();
    });
    chips.appendChild(btn);
  });
  wrap.appendChild(chips);
  messagesEl.appendChild(wrap);
  scrollDown();
}

renderExamples();
refreshCatDatalist();
loadLedger();
