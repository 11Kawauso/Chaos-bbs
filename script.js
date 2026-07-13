// ここだけ掲示板(仮) - Firestore接続版
// type="module" で読み込むこと(index.html側で指定済み)

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, serverTimestamp,
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
const COOLDOWN_SEC = 5;
const MESSAGE_LIMIT = 50;   // 画面に表示する最新件数
const ROOM_ID = "1";        // 部屋を増やすときはここを切り替える仕組みにする

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

    // 最新50件を古い順に並べ直して全描画(件数が少ないので十分軽い)
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
      div.textContent = m.text;
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

  // 先にUIを進めてクールダウン開始(連打防止)
  input.value = '';
  updateCharCount();
  startCooldown();
  input.focus();

  try {
    await addDoc(collection(db, 'rooms', ROOM_ID, 'messages'), {
      text: text,
      uid: myUid,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.error(err);
    statusEl.textContent = '送信に失敗しました。';
    statusEl.classList.add('error');
    setTimeout(() => { statusEl.textContent = ''; statusEl.classList.remove('error'); }, 3000);
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
