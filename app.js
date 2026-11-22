const get = id => document.getElementById(id);
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const count = get('player-count');
const roster = get('roster');
const playerNames = Array(10).fill('');
const advance = get('advance');
let names = [];
let index = 0;
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

function actionLabel() {
  return index === names.length - 1 ? '结束本轮发言' : '结束并录制下一位';
}

function showSpeaker() {
  get('progress').textContent = '第 ' + (index + 1) + ' 位 / 共 ' + names.length + ' 位';
  get('speaker').textContent = names[index];
  advance.textContent = actionLabel();
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
  index++;
  showTranscript();
  if (index < names.length) {
    showSpeaker();
    startRecognition(true);
  } else {
    get('progress').textContent = names.length + ' 位玩家';
    get('speaker').textContent = '本轮结束';
    get('status').textContent = '本轮发言摘要已生成。';
    advance.textContent = '开始下一轮';
    advance.disabled = false;
  }
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
    advance.textContent = actionLabel();
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
    if (recognition !== session) return;
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

function renderRoster(focusPosition) {
  const total = Number(count.value);
  const rows = playerNames.slice(0, total).map((name, position) => {
    const row = document.createElement('li');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = name;
    input.placeholder = '玩家名字';
    input.maxLength = 60;
    input.required = true;
    input.setAttribute('aria-label', '第 ' + (position + 1) + ' 位玩家名字');
    input.oninput = () => {
      playerNames[position] = input.value;
      notice();
    };
    row.append(input);
    for (const [delta, label] of [[-1, '上移'], [1, '下移']]) {
      const target = position + delta;
      const move = document.createElement('button');
      move.type = 'button';
      move.textContent = label;
      move.setAttribute('aria-label', '第 ' + (position + 1) + ' 位玩家' + label);
      move.disabled = target < 0 || target >= total;
      move.onclick = () => {
        [playerNames[position], playerNames[target]] = [playerNames[target], playerNames[position]];
        renderRoster(target);
        notice();
      };
      row.append(move);
    }
    return row;
  });
  roster.replaceChildren(...rows);
  if (focusPosition !== undefined) rows[focusPosition].firstElementChild.focus();
}

count.onchange = () => {
  renderRoster();
  notice();
};
renderRoster();

get('setup').onsubmit = event => {
  event.preventDefault();
  const ordered = playerNames.slice(0, Number(count.value)).map(name => name.trim());
  if (ordered.some(name => !name)) return notice('请填完所有玩家的名字。');
  if (new Set(ordered).size !== ordered.length) return notice('请给同名玩家加上区分用的昵称。');
  if (!SpeechRecognition) return notice('当前浏览器不支持语音识别。请用 Safari 或 Chrome 打开站点后重试。');
  notice();
  names = ordered;
  index = 0;
  get('setup').hidden = true;
  get('session').hidden = false;
  showSpeaker();
  startRecognition();
};

advance.onclick = () => {
  if (retryStartup) return retryStartup();
  if (index >= names.length) {
    get('summaries').replaceChildren();
    get('results').hidden = true;
    index = 0;
    showSpeaker();
    startRecognition();
    return;
  }
  if (!recognition) {
    if (interim) transcript.push(interim);
    interim = '';
    retryUsed = false;
    startRecognition();
    return;
  }
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
};
