// ここだけ掲示板(仮) - Firestore接続版
// type="module" で読み込むこと(index.html側で指定済み)

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, serverTimestamp, Timestamp,
  query, orderBy, limit, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

// ---- Firebase設定 ----
const firebaseConfig = {
  apiKey: "AIzaSyDk3pCvtnTBqUIcNCkREY43ZNmLC8GW3Lo",
  authDomain: "chaos-bbs.firebaseapp.com",
  projectId: "chaos-bbs",
  storageBucket: "chaos-bbs.firebasestorage.app",
  messagingSenderId: "403590026261",
  appId: "1:403590026261:web:acf96d0b600ee140782a1c"
};

const MAX_CHARS = 100;
const COOLDOWN_SEC = 10;    // 10秒に変更
const MESSAGE_LIMIT = 20;   // 表示は最新20件(読み取り節約)
const EXPIRE_DAYS = 7;      // 投稿の保持期間(TTLで自動削除される)
const ROOM_ID = "1";

// ============================================================
// NGワード設定(2段階)
//
// [1] NG_STRICT: 無条件アウト組
//     漢字・当て字を含む語。日常会話に偶然出ることがないので、
//     どこに含まれていても問答無用でブロック。
//     判定前に正規化されるため「死ネ」「ｼﾈ(死ね系当て字)」等の
//     表記ゆれも引っかかる。
//
// [2] NG_BOUNDED: 文脈判定組
//     ひらがなだけの語。「〜だしね」「ところすごい」のような
//     日常会話と衝突するため、
//     「直前の文字がひらがなならセーフ」というルールで判定。
//     例:「だしね」→セーフ /「しね」「お前しね」「マジしね」→アウト
// ============================================================
const NG_STRICT = [
  // 攻撃・暴言系
  '死ね', '氏ね', '市ね', '4ね', 'タヒね',
  '殺す', '殺せ', '殺害',
  'くたばれ',
  '自殺しろ', 'じさつしろ',
  // 性的な単語(広告規約対策も兼ねる)
  'セックス', 'せっくす', 'セフレ', 'オナニー', 'フェラ',
  'ちんこ', 'ちんぽ', 'まんこ',
  // 出会い・売買春系の勧誘(法的リスクがあるので確実に止める)
  '援交', '円光', '売春', '買春', 'パパ活',
];

const NG_BOUNDED = [
  'しね', 'ころす', 'ころせ',
];

// ---- 正規化(強): 無条件アウト組の判定用 ----
// 全角→半角(NFKC)、小文字化、カタカナ→ひらがな、空白と区切り記号を除去
function normalizeStrong(str) {
  let s = str.normalize('NFKC').toLowerCase();
  s = s.replace(/[\u30a1-\u30f6]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
  s = s.replace(/[\s・._\-~〜*]/g, '');
  return s;
}

// ---- 正規化(弱): 文脈判定組の判定用 ----
// 空白・記号・カタカナはそのまま残す(前後の文脈を保つため)
function normalizeLight(str) {
  return str.normalize('NFKC').toLowerCase();
}

// ひらがなの語を「ひらがな・カタカナ両対応」の正規表現パターンにする
// 例: 'しね' → '[しシ][ねネ]' (「シネ」「シね」等にも対応)
function toKanaFlexPattern(word) {
  return [...word].map(ch => {
    const code = ch.charCodeAt(0);
    if (code >= 0x3041 && code <= 0x3096) {
      return `[${ch}${String.fromCharCode(code + 0x60)}]`;
    }
    return ch;
  }).join('');
}

// 正規化済みリスト(起動時に1回だけ作る)
const NG_STRICT_NORMALIZED = NG_STRICT.map(normalizeStrong);

// 文脈判定: 「直前がひらがな以外(または文頭)」の出現だけをNGとみなす
// (?<![ぁ-ん]) = 直前にひらがながない位置、という意味の正規表現
// 例:「だしね」→直前「だ」がひらがな→セーフ /「しね」「お前しね」「マジしね」→アウト
const NG_BOUNDED_REGEXES = NG_BOUNDED.map(w =>
  new RegExp(`(?<![ぁ-ん])${toKanaFlexPattern(w)}`)
);

// テキストにNGワードが含まれるか
function containsNgWord(text) {
  const strong = normalizeStrong(text);
  if (NG_STRICT_NORMALIZED.some(ng => strong.includes(ng))) return true;

  const light = normalizeLight(text);
  return NG_BOUNDED_REGEXES.some(re => re.test(light));
}

// 表示用マスク: NGワード部分を●に置換
// (表記ゆれで位置の特定が難しいものは、安全側に倒して全体をマスク)
function maskNgWords(text) {
  let masked = text;
  for (const ng of NG_STRICT) {
    masked = masked.split(ng).join('●'.repeat([...ng].length));
  }
  for (const re of NG_BOUNDED_REGEXES) {
    masked = masked.replace(new RegExp(re.source, 'g'), m => '●'.repeat([...m].length));
  }
  if (containsNgWord(masked)) {
    masked = '●'.repeat(Math.min([...text].length, 10));
  }
  return masked;
}

// ============================================================
// 心得(右側の掛け軸)
// 約束が破られるたびに、管理人が悲しみとともにここへ1行追加する。
// 番号(一、二、三…)は自動で振られる。
// ============================================================
const PRECEPTS = [
  '匿名である',
  '投稿は消せない',
  'どうせすぐ流れる',
  // ↓ 破られた約束はここから下に増えていく
];

// 1〜99を漢数字にする(心得がそんなに増えないことを祈る)
function toKanjiNum(n) {
  const d = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n < 10) return d[n];
  const t = Math.floor(n / 10), r = n % 10;
  return (t > 1 ? d[t] : '') + '十' + d[r];
}

function renderPrecepts() {
  const list = document.getElementById('preceptsList');
  if (!list) return;
  list.innerHTML = '';
  PRECEPTS.forEach((p, i) => {
    const li = document.createElement('li');
    li.textContent = `${toKanjiNum(i + 1)}、${p}`;
    list.appendChild(li);
  });
}
renderPrecepts();

// ============================================================
// 広告ブロック時の負け惜しみ
// 読み込みから3秒後、広告(iframe)が表示されていなければ
// ランダムで一言表示する
// ============================================================
const AD_FALLBACK_MESSAGES = [
  'ここには広告が\nあるはずだった',
  '想像上の広告',
  '広告ブロッカーに\n敗北した枠',
  'このスペースの\n気持ちも考えて',
  '【広告】\nこの枠、今日も無職',
  '広告\n(あなたの心の中に)',
];

setTimeout(() => {
  const slot = document.getElementById('adSlot');
  const fallback = document.getElementById('adFallback');
  if (!slot || !fallback) return;
  const iframe = slot.querySelector('iframe');
  const adVisible = iframe && iframe.offsetHeight > 0;
  if (!adVisible) {
    fallback.textContent =
      AD_FALLBACK_MESSAGES[Math.floor(Math.random() * AD_FALLBACK_MESSAGES.length)];
    slot.classList.add('no-ad');
  }
}, 3000);

// ============================================================

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const panel = document.getElementById('chatPanel');
const input = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const charCount = document.getElementById('charCount');
const cooldownLabel = document.getElementById('cooldownLabel');
const statusEl = document.getElementById('status');

let myUid = null;
let cooldownRemain = 0;
let cooldownTimer = null;
let authReady = false;
let started = false;

// ---- 一時的なステータス表示 ----
function flashStatus(message, ms = 3000) {
  statusEl.textContent = message;
  statusEl.classList.add('error');
  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.classList.remove('error');
  }, ms);
}

// ---- 匿名ログイン ----
onAuthStateChanged(auth, (user) => {
  if (user) {
    myUid = user.uid;
    authReady = true;
    statusEl.textContent = '';
    updateSendState();
    startListening();
  }
});

signInAnonymously(auth).catch((err) => {
  console.error(err);
  statusEl.textContent = '接続に失敗しました。時間をおいて再読み込みしてください。';
  statusEl.classList.add('error');
});

// ---- リアルタイム受信 ----
function startListening() {
  if (started) return;
  started = true;

  const messagesRef = collection(db, 'rooms', ROOM_ID, 'messages');
  const q = query(messagesRef, orderBy('createdAt', 'desc'), limit(MESSAGE_LIMIT));

  onSnapshot(q, (snapshot) => {
    const stick = isNearBottom();

    const items = [];
    snapshot.forEach(doc => {
      const d = doc.data({ serverTimestamps: 'estimate' });
      items.push({ id: doc.id, text: d.text, uid: d.uid });
    });
    items.reverse();

    panel.querySelectorAll('.msg').forEach(el => el.remove());
    for (const m of items) {
      const div = document.createElement('div');
      div.className = 'msg' + (m.uid === myUid ? ' mine' : '');
      div.textContent = maskNgWords(m.text);  // ← 表示時マスク
      panel.appendChild(div);
    }

    if (stick) panel.scrollTop = panel.scrollHeight;
  }, (err) => {
    console.error(err);
    statusEl.textContent = '読み込みエラーが発生しました。再読み込みしてください。';
    statusEl.classList.add('error');
  });
}

function isNearBottom() {
  return panel.scrollHeight - panel.scrollTop - panel.clientHeight < 80;
}

// ---- 文字数カウント ----
function updateCharCount() {
  const len = [...input.value].length; // サロゲートペア対応
  charCount.textContent = `${len} / ${MAX_CHARS}`;
  charCount.classList.toggle('over', len > MAX_CHARS);
  updateSendState();
}
input.addEventListener('input', updateCharCount);

// ---- 送信 ----
function updateSendState() {
  const len = [...input.value].length;
  const ok = authReady && len > 0 && len <= MAX_CHARS && cooldownRemain === 0;
  sendBtn.disabled = !ok;
}

function startCooldown() {
  cooldownRemain = COOLDOWN_SEC;
  cooldownLabel.textContent = `あと${cooldownRemain}秒`;
  updateSendState();
  cooldownTimer = setInterval(() => {
    cooldownRemain--;
    if (cooldownRemain <= 0) {
      clearInterval(cooldownTimer);
      cooldownRemain = 0;
      cooldownLabel.textContent = '';
    } else {
      cooldownLabel.textContent = `あと${cooldownRemain}秒`;
    }
    updateSendState();
  }, 1000);
}

async function send() {
  const text = input.value.trim();
  const len = [...text].length;
  if (!authReady || !text || len > MAX_CHARS || cooldownRemain > 0) return;

  // ---- NGワードチェック(送信ブロック) ----
  if (containsNgWord(text)) {
    flashStatus('投稿できない言葉が含まれています');
    return;  // クールダウンは発動させない(書き直してすぐ送れるように)
  }

  // 先にUIを進めてクールダウン開始(連打防止)
  input.value = '';
  updateCharCount();
  startCooldown();
  input.focus();

  try {
    await addDoc(collection(db, 'rooms', ROOM_ID, 'messages'), {
      text: text,
      uid: myUid,
      createdAt: serverTimestamp(),
      // TTL用: この日時を過ぎるとFirestoreが自動削除する
      expireAt: Timestamp.fromDate(new Date(Date.now() + EXPIRE_DAYS * 24 * 60 * 60 * 1000))
    });
  } catch (err) {
    console.error(err);
    flashStatus('送信に失敗しました。');
  }
}

sendBtn.addEventListener('click', send);
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
});

updateCharCount();
