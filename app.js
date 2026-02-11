// app.js  (KANJI-Y QUIZ UI+SOUND BUILD 2026-02-11)
// 仕様：入力式（読み） / 通常10問 / 連続学習（全問） / タイマー15秒+バー
// BGM/SE：開始時ON（メニュークリック起点で確実に鳴る。start=1自動開始は環境により鳴らない場合あり）

const TOTAL_QUESTIONS = 10;

// ===== Timer settings =====
const QUESTION_TIME_SEC = 15; // ★15秒
const WARN_AT_SEC = 3;        // 残り3秒で軽い発光

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

// ===== Debug / error surface =====
function uiLog(msg) {
  const s = String(msg ?? "");
  if (progressEl) progressEl.textContent = s;
  if (statusEl) statusEl.textContent = s;
  if (startNoteEl) {
    if (URL_DEBUG) {
      startNoteEl.classList.remove("start-hidden");
      startNoteEl.style.display = "block";
    }
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

// ===== Mode =====
let mode = "normal";
function setMode(next) {
  mode = next === "endless" ? "endless" : "normal";
  if (modePillEl) modePillEl.textContent = mode === "endless" ? "連続学習" : "通常（10問）";
}

// ===== Audio implementation =====
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

function unlockAudioOnceFromGesture() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  // BGMはここでは触らない（←これが重要。後からpauseされる事故を防ぐ）

  // SEだけ“解錠”する（失敗してもOK）
  try { safePlay(seGo); safePause(seGo); } catch (_) {}
  try { safePlay(seCorrect); safePause(seCorrect); } catch (_) {}
  try { safePlay(seWrong); safePause(seWrong); } catch (_) {}
}

  // SEの解錠（鳴らなくてもOK）
  try { safePlay(seGo); safePause(seGo); } catch (_) {}
  try { safePlay(seCorrect); safePause(seCorrect); } catch (_) {}
  try { safePlay(seWrong); safePause(seWrong); } catch (_) {}
}

function loadBgmOn() {
  try {
    const v = localStorage.getItem(STORAGE_KEY_BGM_ON);
    if (v === null) return true; // ★初期はON
    return v === "1";
  } catch {
    return true;
  }
}
function saveBgmOn(on) {
  try { localStorage.setItem(STORAGE_KEY_BGM_ON, on ? "1" : "0"); } catch (_) {}
}
function setBgm(on) {
  if (on) safePlay(bgmAudio);
  else safePause(bgmAudio);
  if (bgmToggleBtn) bgmToggleBtn.textContent = on ? "BGM: ON" : "BGM: OFF";
  saveBgmOn(on);
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
      timerInnerEl.style.filter = (remain <= WARN_AT_SEC * 1000)
        ? "drop-shadow(0 0 14px rgba(255,61,207,0.75))"
        : "none";
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
    alt: String(r.alt ?? "").trim(),
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
  score = 0; index = 0; combo = 0; maxCombo = 0;
  const shuffled = shuffle([...pool]);

  order = (mode === "endless")
    ? shuffled
    : shuffled.slice(0, Math.min(TOTAL_QUESTIONS, shuffled.length));

  render();
}
function startNewSession() { startWithPool(questions); }

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
  unlockAudioOnceFromGesture();
  if (startScreenEl) startScreenEl.style.display = "none";

  setBgm(true);          // ON表示＋保存
  safePlay(bgmAudio);    // 念押しで鳴らす

  await runCountdown();
  startNewSession();
}

async function beginAutoStart() {
  if (startScreenEl) startScreenEl.style.display = "none";
  if (bgmToggleBtn) bgmToggleBtn.textContent = loadBgmOn() ? "BGM: ON" : "BGM: OFF";
  await runCountdown();
  setBgm(loadBgmOn()); // 規制で鳴らない場合あり（停止はしない）
  startNewSession();
}

// ===== Events =====
if (submitBtn) submitBtn.addEventListener("click", () => judge());
if (answerInput) answerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); judge(); }
});
if (nextBtn) nextBtn.addEventListener("click", () => {
  if (index >= order.length - 1) {
    if (statusEl) statusEl.textContent = "終了";
    stopTimer();
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

// Start menu
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

    if (bgmToggleBtn) bgmToggleBtn.textContent = loadBgmOn() ? "BGM: ON" : "BGM: OFF";

    if (!window.CSVUtil || typeof window.CSVUtil.load !== "function") {
      throw new Error("CSVUtil が見つかりません（csv.js の読み込み確認）");
    }

    uiLog("BOOT: loading questions.csv ...");
    const baseUrl = new URL("./", location.href).toString();
    const csvUrl = new URL("questions.csv", baseUrl).toString();
    const raw = await window.CSVUtil.load(csvUrl);
    questions = raw.map(normalizeRow);

    uiLog(`BOOT: ready (questions=${questions.length})`);

    disableInput(true);
    ensureTimerUI();
    if (timerTextEl) timerTextEl.textContent = `${QUESTION_TIME_SEC.toFixed(0)}.0s`;
    if (timerInnerEl) timerInnerEl.style.width = "100%";

    if (questionEl) questionEl.textContent = "始めたいメニューを選んでください。";

    if (URL_AUTOSTART) await beginAutoStart();
  } catch (e) {
    uiLog("BOOT FAILED: " + (e?.message ?? e));
  }
})();
