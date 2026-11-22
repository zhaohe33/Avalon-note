const get = id => document.getElementById(id);
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const namesField = get('player-names');
const roster = get('roster');
let selectedSeat = 0;
let playerNames = [];
const advance = get('advance');
let names = [];
let index = -1;
let startingSeat = -1;
let direction = 0;
let nextSpeaker = -1;
let transcript = [];
let sessionParts = [];
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
  live.textContent = [...transcript, ...sessionParts].filter(Boolean).join('\n');
  live.hidden = !live.textContent;
  live.scrollTop = live.scrollHeight;
}

function updateDirection() {
  const active = index !== -1;
  get('direction-controls').hidden = !active;
  get('clockwise').setAttribute('aria-pressed', direction === 1);
  get('counterclockwise').setAttribute('aria-pressed', direction === -1);
  const next = get('next');
  next.disabled = !direction || finishing;
  next.textContent = direction && active ? '下一位 · ' + names[nextSeat()] : '下一位';
}

function nextSeat() {
  return (index + direction + names.length) % names.length;
}

function showSpeaker() {
  const active = index !== -1;
  const selected = active ? index : startingSeat;
  get('speaker').textContent = selected === -1 ? '请选择发言人' : names[selected];
  get('status').textContent = active ? '' : '点头像选首位，然后按「开始发言」。';
  advance.disabled = selected === -1;
  advance.textContent = active ? '结束这段发言' : '开始发言';
  Array.from(roster.children).forEach(updateSeat);
  updateDirection();
}

function chooseSpeaker(position) {
  if (finishing) return;
  if (index === -1) {
    startingSeat = position;
    showSpeaker();
  } else if (index !== position) {
    stopTurn(position);
  } else if (retryStartup || !recognition) {
    advance.click();
  }
}

get('clockwise').onclick = () => {
  direction = 1;
  updateDirection();
};
get('counterclockwise').onclick = () => {
  direction = -1;
  updateDirection();
};
get('next').onclick = () => {
  if (index !== -1 && direction) stopTurn(nextSeat());
};

function summarizeSpeech(parts) {
  const seatNumbers = {一: '1', 二: '2', 两: '2', 三: '3', 四: '4', 五: '5',
    六: '6', 七: '7', 八: '8', 九: '9', 十: '10'};
  const seatPattern = '(?:10|[1-9]|[一二两三四五六七八九十])';
  const seatReferences = '(?<![0-9])(' + seatPattern + '(?:号)?(?:\\s*[、和跟与及]\\s*'
    + seatPattern + '(?:号)?)*号)(?![0-9])';
  const nicknames = [...names].filter(name => name.length > 1).sort((a, b) => b.length - a.length)
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const references = new RegExp([seatReferences, ...nicknames].join('|'), 'gu');
  const groups = new Map();
  function add(label, value) {
    if (!value) return;
    if (!groups.has(label)) groups.set(label, new Set());
    groups.get(label).add(value);
  }

  for (const part of parts) {
    for (const clause of part.split(/[，,。！？；!?;]+/u)) {
      const text = clause.trim();
      const reason = text.match(/(?:主要是因为|因为|理由是|原因是)(.+)/u);
      if (reason) add('给出的理由', reason[1].trim().replace(/^我(?:觉得|认为)\s*/u, ''));
      const claim = reason ? text.slice(0, reason.index) : text;
      for (const match of claim.matchAll(references)) {
        const before = claim.slice(0, match.index);
        const after = claim.slice(match.index + match[0].length);
        const target = match[1] ? match[1].match(new RegExp(seatPattern, 'gu'))
          .map(number => (seatNumbers[number] || number) + '号').join('、') : match[0];
        if (/(?:不|没)(?:反对|怀疑|质疑)(?:让|由)?\s*$/u.test(before)) continue;
        if (/不一定|不确定|不知道|不能判断|有没有|要不要|会不会/u.test(before + after)) {
          add('暂未确定', target);
        } else if (/(?:不太|不怎么|不|没|并不|暂不)(?:同意|支持|相信|信任|建议|推荐)\s*$/u.test(before)
          || /(?:反对|不赞成)(?:让|由)?\s*$/u.test(before)
          || /^\s*(?:别|不要|不适合|不能)\s*(?:上车|进队|组队)/u.test(after)) {
          add('反对或保留', target);
        } else if (/(?:怀疑|质疑|不看好)\s*$/u.test(before)
          || /^\s*(?:有问题|有嫌疑|可疑|很可疑)/u.test(after)) {
          add('质疑对象', target);
        } else if (/(?:建议|提议|推荐|想让|可以让)(?:先|让|由|带)?\s*$/u.test(before)
          && /^\s*(?:一起|优先|可以|先|来|去)?\s*(?:上车|组队|进队|做任务)/u.test(after)) {
          add('建议上车', target);
        } else if (/(?:支持|赞成|相信|信任|看好)\s*$/u.test(before)) {
          add('倾向支持', target);
        }
      }
      if (/(?:我)?(?:会|准备|打算|决定)(?:投)?赞成票/u.test(claim)) add('投票意向', '赞成');
      if (/(?:我)?(?:会|准备|打算|决定)(?:投)?反对票/u.test(claim)) add('投票意向', '反对');
    }
  }
  return [...groups].map(([label, values]) => label + '：' + [...values].join('；'));
}

function addSummary(name, parts) {
  const row = document.createElement('li');
  const heading = document.createElement('strong');
  heading.textContent = name;
  row.append(heading);
  const highlights = summarizeSpeech(parts);
  if (parts.length) {
    const list = document.createElement('ul');
    for (const text of highlights) {
      const item = document.createElement('li');
      item.textContent = text;
      list.append(item);
    }
    if (!highlights.length) {
      const message = document.createElement('p');
      message.textContent = '暂未提取到明确的队伍建议、立场或理由。';
      row.append(message);
    } else {
      row.append(list);
    }
    const details = document.createElement('details');
    const label = document.createElement('summary');
    const full = document.createElement('p');
    label.textContent = '查看完整转写';
    full.className = 'full-transcript';
    full.textContent = parts.join('\n');
    details.append(label, full);
    row.append(details);
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
  const parts = [...transcript, ...sessionParts].filter(Boolean);
  transcript = [];
  sessionParts = [];
  finishing = false;
  retryUsed = false;
  index = nextSpeaker;
  if (index === -1) {
    startingSeat = -1;
    direction = 0;
  }
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
  transcript.push(...sessionParts.filter(Boolean));
  sessionParts = [];
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
    // Each recognition session reuses result indices as provisional text becomes final.
    // Keep the last nonempty result if the browser drops that slot during shutdown.
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript.trim();
      if (text) {
        sessionParts[i] = text;
        retryUsed = false;
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
  button.setAttribute('aria-pressed', position === (names.length ? (index === -1 ? startingSeat : index) : selectedSeat));
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
  get('table-hint').textContent = '点头像选人';
  roster.removeAttribute('aria-describedby');
  get('setup').hidden = true;
  get('session').hidden = false;
  showSpeaker();
};

advance.onclick = () => {
  if (index === -1) {
    if (startingSeat === -1) return;
    index = startingSeat;
    showSpeaker();
    startRecognition();
    return;
  }
  if (retryStartup) return retryStartup();
  if (!recognition) {
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
  updateDirection();
  get('status').textContent = '正在收尾上一位的语音…';
  const session = recognition;
  stopTimer = setTimeout(() => {
    if (recognition !== session) return;
    recognition = null;
    try { session.abort(); } catch {}
    finishTurn();
  }, 4000);
  try {
    session.stop();
  } catch {
    clearTimeout(stopTimer);
    recognition = null;
    finishTurn();
  }
}
