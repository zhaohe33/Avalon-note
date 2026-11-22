const get = id => document.getElementById(id);
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const namesField = get('player-names');
const roster = get('roster');
let selectedSeat = 0;
let playerNames = [];
const advance = get('advance');
let names = [];
let index = -1;
let nextSpeaker = -1;
let transcript = [];
let interim = '';
let recognition;
let retryStartup;
let finishing = false;
let retryUsed = false;
let stopTimer;

function notice(message = '') {
  get('notice').textContent = message;
  get('notice').hidden = !message;
}

function showTranscript() {
  const live = get('live');
  live.textContent = [...transcript, interim].filter(Boolean).join(' ');
  live.hidden = !live.textContent;
  live.scrollTop = live.scrollHeight;
}

function showSpeaker() {
  const active = index !== -1;
  get('speaker').textContent = active ? names[index] : '请选择发言人';
  get('status').textContent = active ? '' : '点圆桌上的头像开始录音。';
  advance.hidden = !active;
  advance.textContent = '结束这段发言';
  Array.from(roster.children).forEach(updateSeat);
}

function chooseSpeaker(position) {
  if (finishing) return;
  if (index === -1) {
    index = position;
    showSpeaker();
    startRecognition();
  } else if (index !== position) {
    stopTurn(position);
  } else if (retryStartup || !recognition) {
    advance.click();
  }
}

function extractHighlights(parts) {
  const sentences = parts.flatMap(part => part.split(/[。！？；!?;\n]+/u))
    .map(text => text.trim()).filter(Boolean);
  const unique = [...new Set(sentences)];
  const relevant = /建议|认为|支持|反对|怀疑|相信|组队|上车|任务|投票|因为|但是/u;
  return unique.map((text, order) => ({text, order, score: Number(relevant.test(text))}))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, 3).sort((a, b) => a.order - b.order)
    .map(({text}) => text.length > 160 ? text.slice(0, 160) + '…' : text);
}

function addSummary(name, parts) {
  const row = document.createElement('li');
  const heading = document.createElement('strong');
  heading.textContent = name;
  row.append(heading);
  const highlights = extractHighlights(parts);
  if (highlights.length) {
    const list = document.createElement('ul');
    for (const text of highlights) {
      const item = document.createElement('li');
      item.textContent = text;
      list.append(item);
    }
    row.append(list);
  } else {
    const empty = document.createElement('p');
    empty.textContent = '没有识别到发言。';
    row.append(empty);
  }
  get('summaries').append(row);
  get('results').hidden = false;
}

function finishTurn() {
  const name = names[index];
  const parts = interim ? [...transcript, interim] : transcript;
  transcript = [];
  interim = '';
  finishing = false;
  retryUsed = false;
  index = nextSpeaker;
  nextSpeaker = -1;
  showTranscript();
  showSpeaker();
  if (index !== -1) startRecognition(true);
  addSummary(name, parts);
}

function paused(message) {
  get('status').textContent = message;
  advance.textContent = '继续录制当前玩家';
  advance.disabled = false;
}

function startRecognition(automatic = false) {
  const session = new SpeechRecognition();
  recognition = session;
  session.lang = 'zh-CN';
  session.continuous = true;
  session.interimResults = true;
  let error;
  let startTimer;
  get('status').textContent = automatic
    ? '正在切换麦克风。等页面显示「正在录音」后再说话。'
    : '正在启动麦克风…';
  advance.disabled = !automatic;
  if (automatic) {
    advance.textContent = '点此启动当前玩家录音';
    retryStartup = () => {
      clearTimeout(startTimer);
      retryStartup = null;
      recognition = null;
      try { session.abort(); } catch {}
      startRecognition();
    };
  }
  const started = () => {
    if (recognition !== session || finishing) return;
    clearTimeout(startTimer);
    retryStartup = null;
    get('status').textContent = '正在录音，请发言。';
    advance.textContent = '结束这段发言';
    advance.disabled = false;
  };
  session.onaudiostart = started;
  session.onresult = event => {
    if (recognition !== session) return;
    started();
    interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0].transcript.trim();
      if (result.isFinal && text) {
        transcript.push(text);
        retryUsed = false;
      } else if (text) {
        interim = (interim + ' ' + text).trim();
      }
    }
    showTranscript();
  };
  session.onerror = event => { error = event.error; };
  session.onend = () => {
    if (recognition !== session) return;
    clearTimeout(startTimer);
    retryStartup = null;
    clearTimeout(stopTimer);
    recognition = null;
    if (finishing) {
      finishTurn();
    } else if ((!error || error === 'no-speech') && !retryUsed) {
      if (interim) transcript.push(interim);
      interim = '';
      retryUsed = true;
      startRecognition(true);
    } else {
      const blocked = error === 'not-allowed' || error === 'service-not-allowed';
      paused(blocked ? '麦克风权限被拒绝。请在 Safari 或 Chrome 中打开网页并允许麦克风。' : '录音已暂停，请点下方按钮继续。');
    }
  };
  startTimer = setTimeout(() => {
    if (recognition !== session || finishing) return;
    recognition = null;
    retryStartup = null;
    try { session.abort(); } catch {}
    paused('麦克风启动超时。如果你在 ChatGPT 里打开了网页，请用 Safari 或 Chrome 打开，允许麦克风后重试。');
  }, 10000);
  try {
    session.start();
  } catch {
    clearTimeout(startTimer);
    recognition = null;
    retryStartup = null;
    paused('无法启动麦克风，请在 Safari 或 Chrome 中打开后重试。');
  }
}

function seatLabel(position) {
  return (position + 1) + ' 号座';
}

function updateSeat(button, position) {
  const name = playerNames[position].trim();
  button.lastElementChild.textContent = name || '待填写';
  button.setAttribute('aria-label', seatLabel(position) + '，' + (name || '待填写'));
  button.setAttribute('aria-pressed', position === (names.length ? index : selectedSeat));
}

function selectSeat(position) {
  selectedSeat = position;
  get('seat-label').textContent = '已选 ' + seatLabel(position) + ' · ' + playerNames[position];
  Array.from(roster.children).forEach(updateSeat);
}

function renderRoster() {
  const total = playerNames.length;
  const validCount = total >= 5 && total <= 10;
  get('player-count').textContent = '已填写 ' + total + ' 位玩家';
  get('roundtable').hidden = !validCount;
  get('seat-editor').hidden = !validCount;
  if (!validCount) {
    roster.replaceChildren();
    return;
  }
  const seats = Array.from({length: total}, (_, position) => {
    const angle = 2 * Math.PI * position / total;
    const button = document.createElement('button');
    const number = document.createElement('span');
    const name = document.createElement('span');
    button.type = 'button';
    button.className = 'seat';
    button.style.left = (50 - 37 * Math.sin(angle)) + '%';
    button.style.top = (50 + 39 * Math.cos(angle)) + '%';
    number.textContent = position + 1;
    number.className = 'seat-number';
    name.className = 'seat-name';
    button.append(number, name);
    button.onclick = () => {
      if (names.length) return chooseSpeaker(position);
      selectSeat(position);
      notice();
    };
    return button;
  });
  roster.replaceChildren(...seats);
  selectSeat(Math.min(selectedSeat, total - 1));
}

function moveSeat(direction) {
  const total = playerNames.length;
  const destination = (selectedSeat + direction + total) % total;
  [playerNames[selectedSeat], playerNames[destination]] = [playerNames[destination], playerNames[selectedSeat]];
  namesField.value = playerNames.join('\n');
  selectSeat(destination);
  notice();
}

function readNames() {
  return namesField.value.split(/\r?\n/u).map(name => name.trim()).filter(Boolean);
}

namesField.oninput = () => {
  playerNames = readNames();
  renderRoster();
  notice();
};
get('move-back').onclick = () => moveSeat(-1);
get('move-forward').onclick = () => moveSeat(1);
renderRoster();

get('setup').onsubmit = event => {
  event.preventDefault();
  const ordered = readNames();
  if (ordered.length < 5 || ordered.length > 10) return notice('请输入 5–10 位玩家的名字，每行一个。');
  if (new Set(ordered).size !== ordered.length) return notice('请给同名玩家加上区分用的昵称。');
  if (!SpeechRecognition) return notice('当前浏览器不支持语音识别。请用 Safari 或 Chrome 打开站点后重试。');
  notice();
  playerNames = ordered;
  renderRoster();
  names = ordered;
  get('speaker-table').append(get('roundtable'));
  get('table-hint').textContent = '点头像发言';
  roster.removeAttribute('aria-describedby');
  get('setup').hidden = true;
  get('session').hidden = false;
  showSpeaker();
};

advance.onclick = () => {
  if (retryStartup) return retryStartup();
  if (!recognition) {
    if (interim) transcript.push(interim);
    interim = '';
    retryUsed = false;
    startRecognition();
    return;
  }
  stopTurn();
};

function stopTurn(position = -1) {
  if (finishing) return;
  nextSpeaker = position;
  if (!recognition) return finishTurn();
  finishing = true;
  advance.disabled = true;
  get('status').textContent = '正在收尾上一位的语音…';
  const session = recognition;
  stopTimer = setTimeout(() => {
    if (recognition !== session) return;
    recognition = null;
    try { session.abort(); } catch {}
    finishTurn();
  }, 2500);
  try {
    session.stop();
  } catch {
    clearTimeout(stopTimer);
    recognition = null;
    finishTurn();
  }
}
