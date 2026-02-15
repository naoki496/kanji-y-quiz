// app.js  (KANJI-Y QUIZ STABLE BUILD 2026-02-11)
// 入力式（読み） / 通常10問 / 連続学習（全問） / タイマー15秒+バー
// 黒背景+ピンク発光（CSS側）
// BGM：開始クリック起点で確実にON再生（解錠処理ではBGMを触らない）
// SE：GO/正解/不正解/TIMEUP（wrong）
// 失敗時：コンソール無しでも画面にエラー表示

const TOTAL_QUESTIONS = 10;

// ===== Timer settings =====
const QUESTION_TIME_SEC = 15;
const WARN_AT_SEC = 3;

// ===== Audio =====
const AUDIO_FILES = {
  bgm: "./assets/bgm.mp3",
  correct: "./assets/correct.mp3",
  wrong: "./assets/wrong.mp3",
  go: "./assets/go.mp3",
};

const STORAGE_KEY_BGM_ON = "kanjiYQuiz.v1.bgmOn";

// ===== URL Params =====
const URLP = new URLSearchParams(location.search);
const URL_MODE = URLP.get("mode");               // normal | endless
const URL_AUTOSTART = URLP.get("start") === "1"; // start=1
const URL_DEBUG = URLP.get("debug") === "1";     // debug=1

// ===== DOM =====
const progressEl = document.getElementById("progress");
const scoreEl = document.getElementById("score");
const questionEl = document.getElementById("question");
const sublineEl = document.getElementById("subline");
const statusEl = document.getElementById("status");

const answerInput = document.getElementById("answerInput");
const submitBtn = document.getElementById("submitBtn");

const nextBtn = document.getElementById("nextBtn");
const restartBtn = document.getElementById("restartBtn");
const meterInner = document.getElementById("meterInner");
const meterLabel = document.getElementById("meterLabel");
const comboLabel = document.getElementById("comboLabel");
const quizEl = document.getElementById("quiz");
const bgmToggleBtn = document.getElementById("bgmToggle");
const modePillEl = document.getElementById("modePill");

const startScreenEl = document.getElementById("startScreen");
const startNoteEl = document.getElementById("startNote");
const modeNormalBtn = document.getElementById("modeNormalBtn");
const modeEndlessBtn = document.getElementById("modeEndlessBtn");

// ===== Error surface =====
function uiLog(msg) {
  const s = String(msg ?? "");
  if (statusEl) statusEl.textContent = s;
  if (URL_DEBUG && startNoteEl) {
    startNoteEl.classList.remove("start-hidden");
    startNoteEl.style.display = "block";
    startNoteEl.textContent = s;
  }
}
window.addEventListener("error", (e) => uiLog("JS ERROR: " + (e?.message || "unknown")));
window.addEventListener("unhandledrejection", (e) => {
  const r = e?.reason;
  uiLog("PROMISE REJECTION: " + (r?.message || String(r || "unknown")));
});

// ===== Utils =====
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function highlightBrackets(str) {
  const safe = escapeHtml(str);
  return safe.replace(/【(.*?)】/g, '【<span class="hl">$1</span>】');
}
function normalizeYomi(raw) {
  const s0 = String(raw ?? "").trim();
  const s1 = s0
    .replace(/[\s\u3000]+/g, "")
    .replace(/[・。、「」、,.．]/g, "")
    .replace(/[ー－−–—]/g, "");
  // カタカナ→ひらがな
  return s1.replace(/[ァ-ン]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ===== Card Reward (kobun/bungakusi compatible) =====
let cardsAll = [];
let cardPoolByRarity = { 3: [], 4: [], 5: [] };

// ✅ cards-hub と統一
const STORAGE_KEY_CARD_COUNTS = "hklobby.v1.cardCounts";
// ✅ 旧キー救済（将来の移行用・現状未使用でもOK）
const LEGACY_KEY_CARD_COUNTS = "kanjiYQuiz.v1.cardCounts";

function normalizeCardRow(r) {
  // cards.csv: id, rarity, name, img, wiki, weight
  const id = String(r.id ?? "").trim();
  const rarity = Number(r.rarity);
  const name = String(r.name ?? "").trim();
  const img = String(r.img ?? "").trim();
  const wiki = String(r.wiki ?? "").trim();
  const weightRaw = r.weight ?? "";
  const weight = Number(weightRaw) || 1;
  return { id, rarity, name, img, wiki, weight };
}

function rebuildCardPoolsFromCsv() {
  const next = { 3: [], 4: [], 5: [] };
  if (!Array.isArray(cardsAll)) cardsAll = [];
  for (const c of cardsAll) {
    if (!c || !c.id) continue;
    if (c.rarity === 3 || c.rarity === 4 || c.rarity === 5) next[c.rarity].push(c);
  }
  cardPoolByRarity = next;
}

function loadCardCounts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CARD_COUNTS);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}
function saveCardCounts(counts) {
  try { localStorage.setItem(STORAGE_KEY_CARD_COUNTS, JSON.stringify(counts)); } catch (_) {}
}

function recordCard(card) {
  const counts = loadCardCounts();
  counts[card.id] = (counts[card.id] ?? 0) + 1;
  saveCardCounts(counts);
  return counts[card.id];
}

function pickWeighted(arr, getWeight) {
  if (!arr || !arr.length) return null;
  let total = 0;
  const ws = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let w = Number(getWeight(arr[i]));
    if (!Number.isFinite(w) || w <= 0) w = 1;
    ws[i] = w;
    total += w;
  }
  if (!Number.isFinite(total) || total <= 0) return arr[Math.floor(Math.random() * arr.length)];

  let r = Math.random() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= ws[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}

function rollCardByStars(stars) {
  if (stars < 3) return null;

  // 評価★ごとの排出確率テーブル（合計 1.0）
  const DROP_TABLE = {
    3: [
      { tier: 3, p: 0.85 },
      { tier: 4, p: 0.15 },
    ],
    4: [
      { tier: 3, p: 0.60 },
      { tier: 4, p: 0.30 },
      { tier: 5, p: 0.10 },
    ],
    5: [
      { tier: 3, p: 0.45 },
      { tier: 4, p: 0.35 },
      { tier: 5, p: 0.20 },
    ],
  };

  const table = DROP_TABLE[Math.min(5, stars)];
  if (!table) return null;

  // tier抽選
  let r = Math.random();
  let tier = null;
  for (const row of table) {
    r -= row.p;
    if (r <= 0) {
      tier = row.tier;
      break;
    }
  }
  if (!tier) tier = table[table.length - 1].tier;

  // CSVプールから抽選
  const pool = cardPoolByRarity?.[tier] || [];
  if (!pool.length) return null;

  const picked = pickWeighted(pool, (c) => c.weight ?? 1);
  if (!picked) return null;

  return { ...picked, rarity: tier };
}

function playCardEffect(rarity) {
  try {
    const el = document.createElement("div");
    el.className = `card-effect r${rarity}`;
    el.innerHTML = `<div class="card-effect-glow"></div>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), rarity === 5 ? 1550 : 1100);
  } catch (_) {}
}

// ===== Mode =====
let mode = "normal";
function setMode(next) {
  mode = next === "endless" ? "endless" : "normal";
  if (modePillEl) modePillEl.textContent = mode === "endless" ? "連続学習" : "通常（10問）";
}

// ===== Audio core =====
const bgmAudio = new Audio(AUDIO_FILES.bgm);
bgmAudio.loop = true;
bgmAudio.volume = 0.25;

const seGo = new Audio(AUDIO_FILES.go);
seGo.volume = 0.6;
const seCorrect = new Audio(AUDIO_FILES.correct);
seCorrect.volume = 0.7;
const seWrong = new Audio(AUDIO_FILES.wrong);
seWrong.volume = 0.7;

let audioUnlocked = false;

function safePlay(a) {
  try { a.currentTime = 0; } catch (_) {}
  try {
    const p = a.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (_) {}
}
function safePause(a) {
  try { a.pause(); } catch (_) {}
}

// ★重要：解錠ではBGMを触らない（“後からpauseされる”事故を防ぐ）
function unlockAudioOnceFromGesture() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  try { safePlay(seGo); safePause(seGo); } catch (_) {}
  try { safePlay(seCorrect); safePause(seCorrect); } catch (_) {}
  try { safePlay(seWrong); safePause(seWrong); } catch (_) {}
}

function loadBgmOn() {
  try {
    const v = localStorage.getItem(STORAGE_KEY_BGM_ON);
    if (v === null) return true; // 初期はON
    return v === "1";
  } catch {
    return true;
  }
}
function saveBgmOn(on) {
  try { localStorage.setItem(STORAGE_KEY_BGM_ON, on ? "1" : "0"); } catch (_) {}
}
function setBgm(on) {
  saveBgmOn(on);
  if (bgmToggleBtn) bgmToggleBtn.textContent = on ? "BGM: ON" : "BGM: OFF";
  if (on) safePlay(bgmAudio);
  else safePause(bgmAudio);
}

// ===== Countdown Overlay =====
let countdownOverlayEl = null;
function ensureCountdownOverlay() {
  if (countdownOverlayEl) return countdownOverlayEl;
  const el = document.createElement("div");
  el.id = "countdownOverlay";
  el.innerHTML = `<div class="countdown-num" id="countdownNum">3</div>`;
  el.style.display = "none";
  document.body.appendChild(el);
  countdownOverlayEl = el;
  return el;
}
async function runCountdown() {
  const overlay = ensureCountdownOverlay();
  const numEl = overlay.querySelector("#countdownNum");
  overlay.style.display = "flex";

  const seq = ["3", "2", "1", "GO"];
  for (const t of seq) {
    numEl.textContent = t;
    numEl.classList.remove("pop");
    void numEl.offsetWidth;
    numEl.classList.add("pop");
    if (t === "GO") safePlay(seGo);
    await new Promise((r) => setTimeout(r, 850));
  }
  overlay.style.display = "none";
}

// ===== Timer UI =====
let timerOuterEl = null;
let timerInnerEl = null;
let timerTextEl = null;

function ensureTimerUI() {
  if (timerOuterEl) return;

  const wrap = document.createElement("div");
  wrap.id = "timerArea";
  wrap.innerHTML = `
    <div id="timerText">
      <div class="timer-left">残り時間</div>
      <div id="timerSec">--</div>
    </div>
    <div id="timerOuter"><div id="timerInner"></div></div>
  `;

  const meterArea = document.getElementById("meterArea");
  if (meterArea && meterArea.parentNode) meterArea.parentNode.insertBefore(wrap, meterArea.nextSibling);
  else if (quizEl) quizEl.prepend(wrap);

  timerOuterEl = wrap.querySelector("#timerOuter");
  timerInnerEl = wrap.querySelector("#timerInner");
  timerTextEl = wrap.querySelector("#timerSec");
}

let timerT0 = 0;
let timerRAF = 0;
let timerActive = false;

function stopTimer() {
  timerActive = false;
  if (timerRAF) cancelAnimationFrame(timerRAF);
  timerRAF = 0;
}
function startTimerForQuestion(onTimeout) {
  ensureTimerUI();
  stopTimer();

  const totalMs = QUESTION_TIME_SEC * 1000;
  timerT0 = performance.now();
  timerActive = true;

  const tick = () => {
    if (!timerActive) return;
    const now = performance.now();
    const elapsed = now - timerT0;
    const remain = Math.max(0, totalMs - elapsed);

    if (timerTextEl) timerTextEl.textContent = `${(remain / 1000).toFixed(1)}s`;
    if (timerInnerEl) {
      timerInnerEl.style.width = `${(remain / totalMs) * 100}%`;
      timerInnerEl.style.filter =
        remain <= WARN_AT_SEC * 1000 ? "drop-shadow(0 0 14px rgba(255,61,207,0.75))" : "none";
    }

    if (remain <= 0) {
      stopTimer();
      onTimeout?.();
      return;
    }
    timerRAF = requestAnimationFrame(tick);
  };

  timerRAF = requestAnimationFrame(tick);
}

// ===== State =====
let questions = [];
let order = [];
let index = 0;
let score = 0;
let combo = 0;
let maxCombo = 0;
let locked = false;

// ===== UI =====
function updateScoreUI() {
  if (scoreEl) scoreEl.textContent = `Score: ${score}`;
  if (comboLabel) comboLabel.textContent = `最大COMBO x${maxCombo}`;
}
function updateMeterUI() {
  const total = order.length || 1;
  const done = Math.min(index, total);
  const percent = Math.round((done / total) * 100);
  if (meterLabel) meterLabel.textContent = `進捗 ${done}/${total} (${percent}%)`;
  if (meterInner) meterInner.style.width = `${percent}%`;
}
function disableInput(disabled) {
  if (answerInput) answerInput.disabled = disabled;
  if (submitBtn) submitBtn.disabled = disabled;
}

function normalizeRow(r) {
  return {
    id: String(r.id ?? "").trim(),
    question: String(r.question ?? "").trim(),
    source: String(r.source ?? "").trim(),
    answer: String(r.answer ?? "").trim(),
    alt: String(r.alt ?? "").trim(), // 「|」区切りで別解
  };
}

function render() {
  const q = order[index];

  if (progressEl) progressEl.textContent = `第${index + 1}問 / ${order.length}`;
  updateScoreUI();
  updateMeterUI();

  const text = q.source ? `${q.question}（${q.source}）` : q.question;
  if (questionEl) questionEl.innerHTML = highlightBrackets(text);
  if (sublineEl) sublineEl.textContent = "";
  if (statusEl) statusEl.textContent = "";

  if (answerInput) {
    answerInput.value = "";
    answerInput.disabled = false;
    answerInput.classList.remove("correct", "wrong");
    setTimeout(() => { try { answerInput.focus(); } catch(_){} }, 0);
  }
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.classList.remove("correct", "wrong");
  }
  if (nextBtn) nextBtn.disabled = true;

  locked = false;
  startTimerForQuestion(() => onTimeUp());
}

function startWithPool(pool) {
  score = 0;
  index = 0;
  combo = 0;
  maxCombo = 0;

  const shuffled = shuffle([...pool]);
  order =
    mode === "endless"
      ? shuffled
      : shuffled.slice(0, Math.min(TOTAL_QUESTIONS, shuffled.length));

  render();
}
function startNewSession() {
  startWithPool(questions);
}

function onTimeUp() {
  if (locked) return;
  locked = true;
  disableInput(true);

  const q = order[index];
  combo = 0;

  if (answerInput) answerInput.classList.add("wrong");
  if (statusEl) statusEl.textContent = `TIME UP（正解：${q.answer}）`;

  safePlay(seWrong);
  if (nextBtn) nextBtn.disabled = false;
}

function judge() {
  if (locked) return;
  locked = true;
  stopTimer();
  disableInput(true);

  const q = order[index];
  const inputRaw = answerInput ? answerInput.value : "";
  const input = normalizeYomi(inputRaw);

  const candidates = [q.answer]
    .concat(q.alt ? q.alt.split("|") : [])
    .map(normalizeYomi)
    .filter(Boolean);

  const isCorrect = input.length > 0 && candidates.includes(input);

  if (isCorrect) {
    score++;
    combo++;
    if (combo > maxCombo) maxCombo = combo;

    if (statusEl) statusEl.textContent = "正解";
    if (answerInput) answerInput.classList.add("correct");
    safePlay(seCorrect);
  } else {
    combo = 0;

    if (statusEl) statusEl.textContent = `不正解（正解：${q.answer}）`;
    if (answerInput) answerInput.classList.add("wrong");
    safePlay(seWrong);
  }

  updateScoreUI();
  updateMeterUI();
  if (nextBtn) nextBtn.disabled = false;
}

// ===== Start flow =====
async function beginFromMenuGesture() {
  // ここが「ユーザー操作起点」
  unlockAudioOnceFromGesture();

  if (startScreenEl) startScreenEl.style.display = "none";

  // ★開始時BGM ON（クリック直後にplay）
  setBgm(true);

  await runCountdown();
  startNewSession();
}

async function beginAutoStart() {
  // 自動開始は音が鳴らない端末がある（規制）ので、状態だけ合わせる
  if (startScreenEl) startScreenEl.style.display = "none";
  setBgm(loadBgmOn());
  await runCountdown();
  startNewSession();
}

// ===== Result Overlay (kobun/bungakusi same flow) =====
let resultOverlay = null;

function getUserMessageByRate(percent) {
  if (percent >= 90) return "素晴らしい！この調子！";
  if (percent >= 70) return "よくできているぞ！";
  if (percent >= 40) return "ここから更に積み重ねよう！";
  return "まずは基礎から固めよう！";
}
function calcStars(score0, total) {
  const percent = total ? (score0 / total) * 100 : 0;
  if (percent >= 90) return 5;
  if (percent >= 80) return 4;
  if (percent >= 65) return 3;
  if (percent >= 50) return 2;
  return 1;
}
function calcRankName(stars, maxCombo0) {
  const boost = maxCombo0 >= 6 ? 1 : 0;
  const s = Math.min(5, Math.max(1, stars + boost));
  const table = { 1: "見習い", 2: "一人前", 3: "職人", 4: "達人", 5: "神" };
  return table[s];
}

function ensureResultOverlay() {
  if (resultOverlay) return;

  resultOverlay = document.createElement("div");
  resultOverlay.className = "result-overlay";
  resultOverlay.innerHTML = `
    <div class="result-card" role="dialog" aria-modal="true">
      <div class="result-head">
        <div id="rankTitle" class="result-title">評価</div>
        <div id="resultRate" class="result-rate">--%</div>
      </div>

      <div id="starsRow" class="stars" aria-label="星評価">
        <div class="star">★</div>
        <div class="star">★</div>
        <div class="star">★</div>
        <div class="star">★</div>
        <div class="star">★</div>
      </div>

      <div id="resultSummary" class="result-summary">---</div>
      <div id="resultDetails" class="result-details">---</div>

      <div class="result-actions">
        <button id="resultRestartBtn" class="ctrl" type="button">もう一回</button>
        <button id="resultRetryWrongBtn" class="ctrl" type="button" disabled style="opacity:.45;">間違い復習</button>
        <button id="resultCollectionBtn" class="ctrl" type="button">図鑑</button>
        <button id="resultCloseBtn" class="ctrl" type="button">閉じる</button>
      </div>
    </div>
  `;
  document.body.appendChild(resultOverlay);

  const rankTitleEl = resultOverlay.querySelector("#rankTitle");
  const rateEl = resultOverlay.querySelector("#resultRate");
  const resultSummaryEl = resultOverlay.querySelector("#resultSummary");
  const resultDetailsEl = resultOverlay.querySelector("#resultDetails");
  const starsRow = resultOverlay.querySelector("#starsRow");

  const resultBtnRestartEl = resultOverlay.querySelector("#resultRestartBtn");
  const resultBtnCollectionEl = resultOverlay.querySelector("#resultCollectionBtn");
  const resultBtnCloseEl = resultOverlay.querySelector("#resultCloseBtn");

  function hide() {
    resultOverlay.classList.remove("show");
  }

  resultOverlay.addEventListener("click", (e) => {
    if (e.target === resultOverlay) hide();
  });
  if (resultBtnCloseEl) resultBtnCloseEl.addEventListener("click", hide);

  if (resultBtnRestartEl) {
    resultBtnRestartEl.addEventListener("click", () => {
      hide();
      stopTimer();
      startNewSession();
    });
  }

  if (resultBtnCollectionEl) {
    resultBtnCollectionEl.addEventListener("click", () => {
      window.location.href = "https://naoki496.github.io/cards-hub/";
    });
  }

  resultOverlay._set = ({ stars, rankName, percent, summary, details }) => {
    if (rankTitleEl) rankTitleEl.textContent = `評価：${rankName}`;
    if (rateEl) rateEl.textContent = `${percent}%`;
    if (resultSummaryEl) resultSummaryEl.textContent = summary;
    if (resultDetailsEl) resultDetailsEl.innerHTML = details;

    const starEls = starsRow ? Array.from(starsRow.querySelectorAll(".star")) : [];
    starEls.forEach((el) => el.classList.remove("on", "pop"));

    void resultOverlay.offsetWidth;
    resultOverlay.classList.add("show");

    for (let i = 0; i < Math.min(5, stars); i++) {
      setTimeout(() => {
        if (starEls[i]) {
          starEls[i].classList.add("on", "pop");
          setTimeout(() => starEls[i].classList.remove("pop"), 140);
        }
      }, 120 * i);
    }
  };
}

function showResultOverlay() {
  ensureResultOverlay();

  const total = order.length || 1;
  const percent = Math.round((score / total) * 100);
  const stars = calcStars(score, total);
  const rank = calcRankName(stars, maxCombo);
  const message = getUserMessageByRate(percent);
  const modeLabel = mode === "endless" ? "連続学習" : "通常";

  let rewardHtml = "";
  if (mode === "normal") {
    const card = rollCardByStars(stars);
    if (card) {
      const n = recordCard(card);
      playCardEffect(card.rarity);

      const specialMsg = card.rarity === 5 ? `<div style="margin-top:6px;">✨SSR！✨</div>` : "";

      rewardHtml = `
        <div class="card-reward">
          <img src="${escapeHtml(card.img)}" alt="${escapeHtml(card.name)}" />
          <div>
            <div class="card-name">獲得：${escapeHtml(card.name)}</div>
            <div class="card-meta">レアリティ：★${card.rarity} ／ 所持回数：${n}</div>
            ${specialMsg}
          </div>
        </div>
      `;
    }
  }

  const details = `
    <div>正解 ${score} / ${total}</div>
    <div>最大COMBO x${maxCombo}</div>
    <div>モード ${escapeHtml(modeLabel)}</div>
    ${rewardHtml}
  `;

  resultOverlay._set({
    stars,
    rankName: rank,
    percent,
    summary: message,
    details,
  });
}

function finish() {
  stopTimer();
  disableInput(true);
  if (nextBtn) nextBtn.disabled = true;

  if (progressEl) progressEl.textContent = "終了";
  if (questionEl) questionEl.textContent = `結果：${score} / ${order.length}`;
  if (sublineEl) sublineEl.textContent = "";
  if (statusEl) statusEl.textContent = "おつかれさまでした。";

  showResultOverlay();
}

// ===== Events =====
if (submitBtn) submitBtn.addEventListener("click", () => judge());
if (answerInput) answerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); judge(); }
});

if (nextBtn) nextBtn.addEventListener("click", () => {
  if (index >= order.length - 1) {
    finish();
    return;
  }
  index++;
  render();
});

if (restartBtn) restartBtn.addEventListener("click", () => {
  stopTimer();
  startNewSession();
});

if (bgmToggleBtn) bgmToggleBtn.addEventListener("click", () => {
  unlockAudioOnceFromGesture();
  const next = !loadBgmOn();
  setBgm(next);
});

// Start menu（見た目は<a>のまま、クリックで開始）
if (modeNormalBtn) modeNormalBtn.addEventListener("click", async (e) => {
  try { e.preventDefault(); } catch(_) {}
  setMode("normal");
  await beginFromMenuGesture();
  try { history.replaceState(null, "", "./index.html?mode=normal&start=1"); } catch(_) {}
});
if (modeEndlessBtn) modeEndlessBtn.addEventListener("click", async (e) => {
  try { e.preventDefault(); } catch(_) {}
  setMode("endless");
  await beginFromMenuGesture();
  try { history.replaceState(null, "", "./index.html?mode=endless&start=1"); } catch(_) {}
});

// ===== Boot =====
(async function boot() {
  try {
    uiLog("BOOT: start");
    setMode(URL_MODE === "endless" ? "endless" : "normal");

    // 初期表示
    if (bgmToggleBtn) bgmToggleBtn.textContent = loadBgmOn() ? "BGM: ON" : "BGM: OFF";

    if (!window.CSVUtil || typeof window.CSVUtil.load !== "function") {
      throw new Error("CSVUtil が見つかりません（csv.js の読み込み確認）");
    }

    uiLog("BOOT: loading questions.csv ...");
    const baseUrl = new URL("./", location.href).toString();
    const csvUrl = new URL("questions.csv", baseUrl).toString();
    const raw = await window.CSVUtil.load(csvUrl);

    questions = raw.map(normalizeRow);

    // ===== cards.csv load (for reward) =====
    try {
      uiLog("BOOT: loading cards.csv ...");
      const cardsUrl = new URL("cards.csv", baseUrl).toString();
      const rawCards = await window.CSVUtil.load(cardsUrl);

      const nextCards = [];
      for (const r of rawCards) {
        try {
          const c = normalizeCardRow(r);
          if (c.id) nextCards.push(c);
        } catch (_) {}
      }
      cardsAll = nextCards;
      rebuildCardPoolsFromCsv();
      uiLog(`BOOT: cards ready (cards=${cardsAll.length})`);
    } catch (e) {
      // cards が無い/壊れているなら“カード獲得だけ無効”
      cardsAll = [];
      cardPoolByRarity = { 3: [], 4: [], 5: [] };
      uiLog("BOOT: cards.csv load failed (reward disabled)");
    }

    if (!questions.length) throw new Error("questions.csv が空です");

    uiLog(`BOOT: ready (questions=${questions.length})`);

    disableInput(true);
    ensureTimerUI();
    ensureResultOverlay();
    if (timerTextEl) timerTextEl.textContent = `${QUESTION_TIME_SEC.toFixed(0)}.0s`;
    if (timerInnerEl) timerInnerEl.style.width = "100%";

    if (questionEl) questionEl.textContent = "始めたいメニューを選んでください。";

    if (URL_AUTOSTART) await beginAutoStart();
  } catch (e) {
    uiLog("BOOT FAILED: " + (e?.message ?? e));
  }
})();
