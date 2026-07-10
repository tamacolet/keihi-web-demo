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
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
  catch { return fallback; }
}
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

let categories = load(LS.categories, DEFAULT_CATEGORIES.slice());
let shortcuts = load(LS.shortcuts, ['交際費', '会議費']);
let fixed = load(LS.fixed, []);

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
function scrollDown() { messagesEl.scrollTop = messagesEl.scrollHeight; }

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
    card.innerHTML = `
      <h4>この内容で記帳しますか？</h4>
      <div class="card-row"><span class="k">日付</span><span class="v">${escapeHtml(current.date)}</span></div>
      <div class="card-row"><span class="k">金額</span><span class="v amount">${Number(current.amount).toLocaleString()}円</span></div>
      <div class="card-row"><span class="k">勘定科目</span><span class="v">${escapeHtml(current.category)}</span></div>
      <div class="card-row"><span class="k">支払先</span><span class="v">${escapeHtml(current.payee || 'なし')}</span></div>
      <div class="card-row"><span class="k">備考</span><span class="v">${escapeHtml(current.notes || 'なし')}</span></div>
      <div class="card-actions">
        <button class="btn btn-success" data-act="record">記帳する</button>
        <button class="btn btn-primary" data-act="edit">修正する</button>
        <button class="btn btn-secondary" data-act="cancel">キャンセル</button>
      </div>
      ${shortcuts.length ? `<div class="card-shortcuts">${shortcuts.map(s => `<button class="chip-btn" data-sc="${escapeHtml(s)}">🏷️ ${escapeHtml(s)}</button>`).join('')}</div>` : ''}
    `;
    card.querySelector('[data-act="record"]').addEventListener('click', onRecord);
    card.querySelector('[data-act="edit"]').addEventListener('click', onEdit);
    card.querySelector('[data-act="cancel"]').addEventListener('click', onCancel);
    card.querySelectorAll('[data-sc]').forEach(b =>
      b.addEventListener('click', () => { current.category = b.dataset.sc; renderCard(); })
    );
  }

  function finalize(html, done) {
    card.classList.add('done');
    card.innerHTML = html;
    if (done) card.classList.add('done');
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
      `, true);
      loadLedger();
      toast('記帳しました！');
    } catch (e) {
      renderCard();
      toast('⚠️ ' + e.message);
    }
  }

  function onEdit() { openEditModal(current, (updated) => { current = updated; renderCard(); }); }
  function onCancel() { finalize('<h4>🚫 記帳をキャンセルしました。</h4>', true); }

  renderCard();
  scrollDown();
}

// ---- 修正モーダル ----
let modalSave = null;
function openEditModal(data, onSave) {
  $('edit-date').value = data.date;
  $('edit-amount').value = data.amount;
  $('edit-category').value = data.category;
  $('edit-payee').value = data.payee || '';
  $('edit-notes').value = data.notes || '';
  refreshCatDatalist();
  modalSave = onSave;
  $('edit-modal').hidden = false;
}
function closeEditModal() { $('edit-modal').hidden = true; modalSave = null; }
$('edit-cancel').addEventListener('click', closeEditModal);
$('edit-save').addEventListener('click', () => {
  const amount = parseInt(String($('edit-amount').value).replace(/[^0-9]/g, ''), 10);
  if (!Number.isFinite(amount) || amount <= 0) { toast('⚠️ 金額は1以上の数字で入力してくりゃれ。'); return; }
  const date = $('edit-date').value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('⚠️ 日付は YYYY-MM-DD 形式で。'); return; }
  const updated = {
    date, amount,
    category: $('edit-category').value.trim() || '未分類',
    payee: $('edit-payee').value.trim(),
    notes: $('edit-notes').value.trim()
  };
  if (modalSave) modalSave(updated);
  closeEditModal();
});
$('edit-modal').addEventListener('click', (e) => { if (e.target.id === 'edit-modal') closeEditModal(); });

function refreshCatDatalist() {
  $('cat-list').innerHTML = categories.map(c => `<option value="${escapeHtml(c)}">`).join('');
}

// ---- 送信 ----
async function handleSend() {
  const text = inputEl.value.trim();
  if (!text && !pendingImage) return;

  addUserMessage(text, pendingImage ? pendingImage.dataUrl : null);
  const imgForReq = pendingImage;
  inputEl.value = ''; autoGrow();
  clearAttachment();
  sendBtn.disabled = true;

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
    if (!res.ok) { addBotBubble('❌ ' + escapeHtml(body.error || 'エラーが発生しました。')); }
    else { addConfirmCard(body.data); }
  } catch (e) {
    thinking.remove();
    addBotBubble('❌ 通信エラーが発生しました。');
  } finally {
    sendBtn.disabled = false;
  }
}
composerEl.addEventListener('submit', (e) => { e.preventDefault(); handleSend(); });
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
});

// textarea 自動リサイズ
function autoGrow() { inputEl.style.height = 'auto'; inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px'; }
inputEl.addEventListener('input', autoGrow);

// ---- 画像添付 ----
function setImageFromFile(file) {
  if (!file || !file.type.startsWith('image/')) { toast('⚠️ 画像ファイルを選んでくりゃれ。'); return; }
  if (file.size > MAX_IMAGE_BYTES) { toast('⚠️ 画像が大きすぎます（上限5MB）。'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    const base64 = String(dataUrl).split(',')[1];
    pendingImage = { base64, mimeType: file.type, dataUrl };
    attachThumb.src = dataUrl;
    attachPreview.hidden = false;
  };
  reader.readAsDataURL(file);
}
function clearAttachment() { pendingImage = null; attachPreview.hidden = true; attachThumb.src = ''; fileInput.value = ''; }
fileInput.addEventListener('change', (e) => setImageFromFile(e.target.files[0]));
$('attach-remove').addEventListener('click', clearAttachment);
document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (item) setImageFromFile(item.getAsFile());
});
['dragover', 'drop'].forEach(ev => document.addEventListener(ev, (e) => e.preventDefault()));
document.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f) setImageFromFile(f);
});

// ---- ライブ台帳 ----
let lastLedgerKey = '';
async function loadLedger() {
  try {
    const res = await fetch('/api/recent');
    const body = await res.json();
    const rows = body.rows || [];
    if (rows.length === 0) { ledgerEl.innerHTML = '<p class="ledger-empty">まだ記帳がありません。<br>左で経費を送ってみてくりゃれ。</p>'; return; }
    const firstKey = rows[0].date + rows[0].amount + rows[0].stamp;
    ledgerEl.innerHTML = rows.map((r, i) => `
      <div class="ledger-row ${i === 0 && firstKey !== lastLedgerKey && lastLedgerKey ? 'fresh' : ''}">
        <div class="lr-top"><span class="lr-cat">${escapeHtml(r.category || '—')}</span><span class="lr-amt">${escapeHtml(r.amount)}円</span></div>
        <div class="lr-sub"><span>${escapeHtml(r.payee || r.notes || '')}</span><span>${escapeHtml(r.date)}</span></div>
      </div>`).join('');
    lastLedgerKey = firstKey;
  } catch {
    ledgerEl.innerHTML = '<p class="ledger-empty">台帳の取得に失敗しました。</p>';
  }
}
$('btn-refresh').addEventListener('click', loadLedger);
setInterval(loadLedger, 20000);

// ---- 設定ドロワー ----
$('btn-settings').addEventListener('click', () => { renderSettings(); $('settings-drawer').hidden = false; });
$('settings-close').addEventListener('click', () => { $('settings-drawer').hidden = true; });
$('settings-drawer').addEventListener('click', (e) => { if (e.target.id === 'settings-drawer') $('settings-drawer').hidden = true; });

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
    `<span class="chip">${escapeHtml(c)}<button data-c="${escapeHtml(c)}" title="削除">✕</button></span>`).join('');
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
    `<span class="chip">${escapeHtml(c)}<button data-s="${escapeHtml(c)}" title="削除">✕</button></span>`).join('');
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
  if (!category) { toast('⚠️ 科目を入力してくりゃれ。'); return; }
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
    'レシート画像や「コンビニ 500円」のような一言を下の欄に入力するか、<b>まずは下の例をタップ</b>してみてくりゃれ👇'
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
