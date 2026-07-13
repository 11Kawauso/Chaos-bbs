(() => {
  const MAX_CHARS = 100;
  const COOLDOWN_SEC = 5;          // ← 5秒に変更(10秒にするならここを10に)
  const MAX_MESSAGES_SHOWN = 60;   // これより古い表示は消える(=流れていく)

  // 部屋は今は1つだけ。増やすときは { 1: [], 2: [], ... } に戻すだけ
  const rooms = { 1: [] };
  let currentRoom = 1;
  let cooldownTimer = null;
  let cooldownRemain = 0;

  const panel = document.getElementById('chatPanel');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('sendBtn');
  const charCount = document.getElementById('charCount');
  const cooldownLabel = document.getElementById('cooldownLabel');

  // ---- 表示 ----
  function isNearBottom() {
    return panel.scrollHeight - panel.scrollTop - panel.clientHeight < 80;
  }

  function makeMsgEl(m) {
    const div = document.createElement('div');
    div.className = 'msg' + (m.mine ? ' mine' : '');
    div.textContent = m.text;
    return div;
  }

  function addMessage(roomId, text, mine = false) {
    const m = { text, mine };
    rooms[roomId].push(m);
    if (rooms[roomId].length > MAX_MESSAGES_SHOWN) rooms[roomId].shift();

    if (roomId === currentRoom) {
      const stick = isNearBottom() || mine;
      panel.appendChild(makeMsgEl(m));
      const msgs = panel.querySelectorAll('.msg');
      if (msgs.length > MAX_MESSAGES_SHOWN) msgs[0].remove();
      if (stick) panel.scrollTop = panel.scrollHeight;
    }
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
    const ok = len > 0 && len <= MAX_CHARS && cooldownRemain === 0;
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

  function send() {
    const text = input.value.trim();
    const len = [...text].length;
    if (!text || len > MAX_CHARS || cooldownRemain > 0) return;
    addMessage(currentRoom, text, true);
    input.value = '';
    updateCharCount();
    startCooldown();
    input.focus();
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });

  // ---- 混雑シミュレーション ----
  const samplePool = [
    'おはよー', 'おは', '朝からはやいわお前ら', 'ニートか???', 'お前もやろ!',
    'おはようございます', 'ここ何する場所?', '何もしない場所', '流れ早すぎw',
    '自分の書き込みどこ行った', 'もう流れたぞ', '草', 'それな', 'は?',
    '仲良くしようや', '今北', '10000人おって', 'んなわけ',
    'ひまー', 'テスト', 'てすと', 'あ', 'w', 'wwww', 'なんの話しとった?',
    '知らん', '広告踏んでけ', '誰?', '匿名やぞ', 'せやった'
  ];
  let demoTimer = null;

  function setDemo(mode) {
    if (demoTimer) { clearInterval(demoTimer); demoTimer = null; }
    ['demoSlow','demoFast','demoOff'].forEach(id => document.getElementById(id).classList.remove('on'));
    if (mode === 'off') {
      document.getElementById('demoOff').classList.add('on');
      return;
    }
    const interval = mode === 'fast' ? 180 : 2500;
    document.getElementById(mode === 'fast' ? 'demoFast' : 'demoSlow').classList.add('on');
    demoTimer = setInterval(() => {
      const text = samplePool[Math.floor(Math.random() * samplePool.length)];
      addMessage(currentRoom, text, false);
    }, interval);
  }

  document.getElementById('demoSlow').addEventListener('click', () => setDemo('slow'));
  document.getElementById('demoFast').addEventListener('click', () => setDemo('fast'));
  document.getElementById('demoOff').addEventListener('click', () => setDemo('off'));

  // ---- 初期メッセージ ----
  ['おはよー', 'おは', '朝からはやいわお前ら\nニートか???', 'お前もやろ!', 'おはようございます']
    .forEach(t => addMessage(1, t));

  updateCharCount();
})();
