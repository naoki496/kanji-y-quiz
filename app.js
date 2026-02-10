/* =========================================================
   kanji-y-quiz app.js  (FINAL / CONSISTENT)
   ========================================================= */

"use strict";

/* =========================
   URL params
   ========================= */
const URLP = new URLSearchParams(location.search);
const URL_MODE = URLP.get("mode") || "normal"; // normal | endless
const URL_AUTOSTART = URLP.get("start") === "1";

/* =========================
   DOM refs
   ========================= */
const startScreenEl = document.getElementById("startScreen");
const modeNormalBtn = document.getElementById("modeNormalBtn");
const modeEndlessBtn = document.getElementById("modeEndlessBtn");

const quizEl = document.getElementById("quiz");
const questionEl = document.getElementById("question");
const sublineEl = document.getElementById("subline");
const statusEl = document.getElementById("status");

const answerInput = document.getElementById("answerInput");
const submitBtn = document.getElementById("submitBtn");

const nextBtn = document.getElementById("nextBtn");
const restartBtn = document.getElementById("restartBtn");

const progressEl = document.getElementById("progress");
const scoreEl = document.getElementById("score");
const comboLabelEl = document.getElementById("comboLabel");
const modePillEl = document.getElementById("modePill");

const bgmToggleBtn = document.getElementById("bgmToggle");

/* =========================
   Audio
   ========================= */
const AUDIO_FILES = {
  bgm: "./assets/bgm.mp3",
  correct: "./assets/correct.mp3",
  wrong: "./assets/wrong.mp3",
  go: "./assets/go.mp3"
};

let bgmAudio = new Audio(AUDIO_FILES.bgm);
bgmAudio.loop = true;

const seCorrect = new Audio(AUDIO_FILES.correct);
const seWrong = new Audio(AUDIO_FILES.wrong);
const seGo = new Audio(AUDIO_FILES.go);

let audioUnlocked = false;

/* =========================
   Result Overlay (必須)
   ========================= */
let resultOverlay = null;
function ensureResultOverlay() {
  if (resultOverlay) return resultOverlay;
  const el = document.createElement("div");
  el.id = "resultOverlay";
  el.style.display = "none";
  el.style.position = "fixed";
  el.style.inset = "0";
  el.style.zIndex = "2000";
  el.style.background = "rgba(0,0,0,0.55)";
  el.style.backdropFilter = "blur(8px)";
  el.style.webkitBackdropFilter = "blur(8px)";
  document.body.appendChild(el);
  resultOverlay = el;
  return el;
}

/* =========================
   State
   ========================= */
let questions = [];
let qIndex = 0;
let score = 0;
let combo = 0;
let locked = false;

/* =========================
   Utils
   ========================= */
function normalizeInput(s) {
  return (s || "")
    .trim()
    .replace(/[ 　]/g, "")
    .replace(/[・、。ー\-]/g, "")
    .replace(/[ァ-ヶ]/g, c =>
      String.fromCharCode(c.charCodeAt(0) - 0x60)
    );
}

function highlightBrackets(text) {
  return text.replace(/【([^】]+)】/g, "<span class='hl'>【$1】</span>");
}

/* =========================
   CSV normalize
   ========================= */
function normalizeRow(r) {
  const id = String(r.id ?? "").trim();
  const question = String(r.question ?? "").trim();
  const answer = String(r.answer ?? "").trim();
  const alt = String(r.alt ?? "").trim();
  if (!id || !question || !answer) {
    throw new Error("Invalid row: id/question/answer required");
  }
  return { id, question, answer, alt };
}

/* =========================
   Countdown (3,2,1,GO)
   ========================= */
function runCountdown() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "countdownOverlay";
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "3000";
    overlay.style.background = "rgba(0,0,0,0.65)";
    document.body.appendChild(overlay);

    const nums = ["3", "2", "1", "GO"];
    let i = 0;

    function showNext() {
      overlay.textContent = nums[i];
      overlay.className = "countdown-num pop";
      if (nums[i] === "GO") {
        try { seGo.play(); } catch {}
      }
      i++;
      if (i < nums.length) {
        setTimeout(showNext, 700);
      } else {
        setTimeout(() => {
          document.body.removeChild(overlay);
          resolve();
        }, 700);
      }
    }
    showNext();
  });
}

/* =========================
   Render
   ========================= */
function renderQuestion() {
  locked = false;
  statusEl.textContent = "";
  answerInput.value = "";
  answerInput.disabled = false;
  submitBtn.disabled = false;
  nextBtn.disabled = true;

  const q = questions[qIndex];
  questionEl.innerHTML = highlightBrackets(q.question);
  sublineEl.textContent = "";
  progressEl.textContent = `問題 ${qIndex + 1} / ${questions.length}`;
  scoreEl.textContent = `Score: ${score}`;
  comboLabelEl.textContent = `最大COMBO x${combo}`;
}

function judge() {
  if (locked) return;
  locked = true;

  answerInput.disabled = true;
  submitBtn.disabled = true;

  const q = questions[qIndex];
  const input = normalizeInput(answerInput.value);
  const answers = [q.answer]
    .concat(q.alt ? q.alt.split("|") : [])
    .map(normalizeInput);

  const ok = answers.includes(input);

  if (ok) {
    score += 10;
    combo += 1;
    statusEl.textContent = "正解";
    try { seCorrect.play(); } catch {}
  } else {
    combo = 0;
    statusEl.textContent = `不正解（正解：${q.answer}）`;
    try { seWrong.play(); } catch {}
  }

  scoreEl.textContent = `Score: ${score}`;
  comboLabelEl.textContent = `最大COMBO x${combo}`;

  nextBtn.disabled = false;
}

function nextQuestion() {
  if (qIndex + 1 < questions.length) {
    qIndex++;
    renderQuestion();
  } else {
    statusEl.textContent = "終了";
  }
}

/* =========================
   Start
   ========================= */
async function beginFromStartScreen() {
  if (startScreenEl) startScreenEl.style.display = "none";
  ensureResultOverlay();
  await runCountdown();
  qIndex = 0;
  score = 0;
  combo = 0;
  renderQuestion();
}

/* =========================
   Events
   ========================= */
submitBtn.addEventListener("click", judge);
answerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") judge();
});
nextBtn.addEventListener("click", nextQuestion);
restartBtn.addEventListener("click", () => location.href = "./index.html");

bgmToggleBtn.addEventListener("click", async () => {
  try {
    if (bgmAudio.paused) {
      await bgmAudio.play();
      bgmToggleBtn.textContent = "BGM: ON";
    } else {
      bgmAudio.pause();
      bgmToggleBtn.textContent = "BGM: OFF";
    }
  } catch {}
});

/* =========================
   Boot
   ========================= */
(async function boot() {
  try {
    const csvUrl = "./questions.csv";
    const raw = await window.CSVUtil.load(csvUrl);
    questions = raw.map(normalizeRow);
  } catch (e) {
    alert("questions.csv の読み込みに失敗しました");
    return;
  }

  if (URL_AUTOSTART) {
    await beginFromStartScreen();
  }
})();
