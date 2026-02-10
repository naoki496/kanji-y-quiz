/* eslint-disable no-console */
(() => {
"use strict";

// ===== URL params =====
const params = new URLSearchParams(location.search);
const previewAll = params.get("preview") === "1";
const debugMode  = params.get("debug") === "1";
const URL_MODE = params.get("mode");
const URL_AUTOSTART = params.get("start") === "1";

// ===== Settings =====
const TOTAL_QUESTIONS = 10;

// ===== Timer settings =====
const QUESTION_TIME_SEC = 20; // 1問あたり
const WARN_AT_SEC = 5;        // 残り5秒で軽い発光（SE無し）

// ✅音声ファイル（root/assets/ 配下）
const AUDIO_FILES = {
  bgm: "./assets/bgm.mp3",
  correct: "./assets/correct.mp3",
  wrong: "./assets/wrong.mp3",
};

// ===== Storage keys =====
const STORAGE_KEY_CARD_COUNTS = "hklobby.v1.cardCounts";
const LEGACY_STORAGE_KEY_CARD_COUNTS = "kobunQuiz.v1.cardCounts";

// quiz local keys (this repo only)
const STORAGE_KEY_BGM_ON = "bungakusiQuiz.v1.bgmOn";
const STORAGE_KEY_LAST_MODE = "bungakusiQuiz.v1.lastMode";

// ===== DOM =====
const startScreenEl = document.getElementById("startScreen");
const modeNormalBtn = document.getElementById("modeNormalBtn");
const modeEndlessBtn = document.getElementById("modeEndlessBtn");
const startBtnEl = document.getElementById("startBtn");
const startNoteEl = document.getElementById("startNote");

const quizEl = document.getElementById("quiz");
const progressEl = document.getElementById("progress");
const scoreEl = document.getElementById("score");
const comboLabel = document.getElementById("comboLabel");
const modePillEl = document.getElementById("modePill");

const meterInner = document.getElementById("meterInner");
const meterLabel = document.getElementById("meterLabel");

const questionEl = document.getElementById("question");
const sublineEl = document.getElementById("subline");
const statusEl = document.getElementById("status");

const answerInput = document.getElementById("answerInput");
const submitBtn = document.getElementById("submitBtn");

const nextBtn = document.getElementById("nextBtn");
const restartBtn = document.getElementById("restartBtn");

const bgmToggleEl = document.getElementById("bgmToggle");

let timerOuterEl = document.getElementById("timerOuter");
let timerInnerEl = document.getElementById("timerInner");
let timerTextEl = document.getElementById("timerText");

// ===== Runtime state =====
let questions = [];
let order = [];
let index = 0;
let score = 0;
let combo = 0;
let maxCombo = 0;
let locked = false;

let mode = "normal"; // normal / endless
let wrongOnlyRetried = false;

// ===== Card data =====
let cardsAll = [];
let cardPoolByRarity = { 3: [], 4: [], 5: [] };

// ===== Audio =====
let audioUnlocked = false;
let bgm = null;
const sePool = makeSEPool();

// ===== Local storage adapter =====
const StorageAdapter = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, val) {
    try { localStorage.setItem(key, val); } catch {}
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch {}
  },
};

// ===== Cards.csv normalize =====
function normalizeCardRow(r) {
  return {
    id: String(r.id ?? "").trim(),
    rarity: Number(r.rarity) || 0,
    name: String(r.name ?? "").trim(),
    img: String(r.img ?? "").trim(),
    wiki: String(r.wiki ?? "").trim(),
    weight: Number(r.weight) || 0,
  };
}

function rebuildCardPoolsFromCsv() {
  cardPoolByRarity = { 3: [], 4: [], 5: [] };
  for (const c of cardsAll) {
    if (c.rarity === 3 || c.rarity === 4 || c.rarity === 5) {
      cardPoolByRarity[c.rarity].push(c);
    }
  }
}

function validateCardsCsv() {
  const seen = new Set();
  for (const c of cardsAll) {
    if (!c.id) throw new Error(`[cards.csv] empty id detected`);
    if (seen.has(c.id)) throw new Error(`[cards.csv] duplicate id: ${c.id}`);
    seen.add(c.id);
  }
}

function makeSEPool() {
  return {
    correct: null,
    wrong: null,
  };
}

function storageAvailable() {
  try {
    const k = "__t__";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

// ===== Card storage =====
function migrateCardCountsIfNeeded() {
  if (!storageAvailable()) return;
  const cur = StorageAdapter.get(STORAGE_KEY_CARD_COUNTS);
  if (cur) return;

  const legacy = StorageAdapter.get(LEGACY_STORAGE_KEY_CARD_COUNTS);
  if (!legacy) return;

  // 旧キーから移行
  try {
    JSON.parse(legacy);
    StorageAdapter.set(STORAGE_KEY_CARD_COUNTS, legacy);
  } catch {
    // legacy broken -> ignore
  }
}

function loadCardCounts() {
  try {
    const raw = StorageAdapter.get(STORAGE_KEY_CARD_COUNTS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCardCounts(counts) {
  StorageAdapter.set(STORAGE_KEY_CARD_COUNTS, JSON.stringify(counts));
}

// ===== Utils =====
function disableChoices(disabled) {
  if (answerInput) answerInput.disabled = disabled;
  if (submitBtn) submitBtn.disabled = disabled;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalizeAnswer(raw) {
  const s = String(raw ?? "")
    .trim()
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[^\d]/g, "");
  const n = Number(s);
  return n || 0;
}

function normalizeRow(r) {
  return {
    id: String(r.id ?? "").trim(),
    question: String(r.question ?? "").trim(),
    // 現行 questions.csv は「【】内のみ」の読みを入れる想定
    answer: String(r.answer ?? "").trim(),
    // 別解は | 区切り（空でもOK）
    alt: String(r.alt ?? "").trim(),
    // 互換用（存在すれば表示）
    source: String(r.source ?? "").trim(),
  };
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function highlightBrackets(text) {
  const html = escapeHtml(text);
  // 【】内だけハイライト
  return html.replace(/【([^】]+)】/g, '<span class="hl">【$1】</span>');
}

function normalizeYomi(raw) {
  // IME/入力ゆれ吸収：空白・一部記号除去、カタカナ→ひらがな
  const s0 = String(raw ?? "").trim();
  const s1 = s0
    .replace(/[\s\u3000]+/g, "")                 // 半角/全角スペース
    .replace(/[・。、「」、,.．]/g, "")          // 句読点など
    .replace(/[ー－−–—]/g, "");                 // 長音/ダッシュ類（不要なら消す）
  // カタカナ→ひらがな
  return s1.replace(/[ァ-ン]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function pickRandom(arr) {
  if (!arr || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickWeighted(arr) {
  if (!arr || !arr.length) return null;
  const total = arr.reduce((sum, a) => sum + (a.weight || 1), 0);
  let r = Math.random() * total;
  for (const a of arr) {
    r -= (a.weight || 1);
    if (r <= 0) return a;
  }
  return arr[arr.length - 1];
}

function ensureCountdownOverlay() {
  let el = document.getElementById("countdownOverlay");
  if (el) return el;
  el = document.createElement("div");
  el.id = "countdownOverlay";
  el.className = "countdown";
  el.innerHTML = `<div class="countdown-num" id="countdownNum">3</div>`;
  document.body.appendChild(el);
  return el;
}

async function runCountdown() {
  const overlay = ensureCountdownOverlay();
  const numEl = document.getElementById("countdownNum");
  overlay.classList.add("show");
  let n = 3;
  if (numEl) numEl.textContent = String(n);
  await new Promise((r) => setTimeout(r, 400));
  n = 2;
  if (numEl) numEl.textContent = String(n);
  await new Promise((r) => setTimeout(r, 400));
  n = 1;
  if (numEl) numEl.textContent = String(n);
  await new Promise((r) => setTimeout(r, 400));
  overlay.classList.remove("show");
  await new Promise((r) => setTimeout(r, 120));
}

function rollCardByStars(stars) {
  // stars: 0..5
  if (!cardsAll.length) return null;

  // simple mapping
  if (stars >= 5) return pickWeighted(cardPoolByRarity[5]) || pickWeighted(cardPoolByRarity[4]) || pickWeighted(cardPoolByRarity[3]);
  if (stars >= 4) return pickWeighted(cardPoolByRarity[4]) || pickWeighted(cardPoolByRarity[3]);
  return pickWeighted(cardPoolByRarity[3]);
}

function recordCard(card) {
  const counts = loadCardCounts();
  const cur = counts[card.id] ?? 0;
  counts[card.id] = cur + 1;
  saveCardCounts(counts);
  return counts[card.id];
}

function playCardEffect(rarity) {
  // effect is CSS-driven; placeholder
  try {
    document.body.dataset.cardFx = String(rarity || "");
    setTimeout(() => { try { delete document.body.dataset.cardFx; } catch (_) {} }, 800);
  } catch (_) {}
}

function updateScoreUI() {
  if (scoreEl) scoreEl.textContent = `Score: ${score}`;
  if (comboLabel) comboLabel.textContent = `最大COMBO x${maxCombo}`;
}

function updateModeUI() {
  if (!modePillEl) return;
  modePillEl.textContent = mode === "endless" ? "連続学習" : "通常（10問）";
}

function updateMeterUI() {
  const total = order.length || 1;
  const done = Math.min(index, total);
  const percent = Math.round((done / total) * 100);

  if (meterLabel) meterLabel.textContent = `進捗 ${done}/${total} (${percent}%)`;
  if (meterInner) meterInner.style.width = `${percent}%`;
}

function setStatusGlitchOnce() {
  if (!statusEl) return;
  statusEl.classList.add("glitch");
  setTimeout(() => {
    try { statusEl.classList.remove("glitch"); } catch (_) {}
  }, 400);
}

function updateStatusUI(text, opt = {}) {
  if (!statusEl) return;
  statusEl.textContent = text || "";
  if (opt.glitch) setStatusGlitchOnce();
}

function flashGood() {
  if (!quizEl) return;
  quizEl.classList.remove("flash-good");
  void quizEl.offsetWidth;
  quizEl.classList.add("flash-good");
}

function shakeBad() {
  if (!quizEl) return;
  quizEl.classList.remove("shake-bad");
  void quizEl.offsetWidth;
  quizEl.classList.add("shake-bad");
}

function pulseNext() {
  if (!nextBtn) return;
  nextBtn.classList.remove("pulse-next");
  void nextBtn.offsetWidth;
  nextBtn.classList.add("pulse-next");
}

async function unlockAudioOnce() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  try {
    const a = new Audio();
    a.src = AUDIO_FILES.correct;
    await a.play().catch(() => {});
    a.pause();
  } catch (_) {}
}

function setBgm(on) {
  StorageAdapter.set(STORAGE_KEY_BGM_ON, on ? "1" : "0");
  if (bgmToggleEl) bgmToggleEl.textContent = `BGM: ${on ? "ON" : "OFF"}`;

  if (!bgm) {
    bgm = new Audio(AUDIO_FILES.bgm);
    bgm.loop = true;
    bgm.volume = 0.35;
  }

  if (on) {
    bgm.play().catch(() => {});
  } else {
    try { bgm.pause(); } catch (_) {}
  }
}

function playSE(kind) {
  try {
    if (kind === "correct") {
      if (!sePool.correct) sePool.correct = new Audio(AUDIO_FILES.correct);
      sePool.correct.currentTime = 0;
      sePool.correct.play().catch(() => {});
    } else {
      if (!sePool.wrong) sePool.wrong = new Audio(AUDIO_FILES.wrong);
      sePool.wrong.currentTime = 0;
      sePool.wrong.play().catch(() => {});
    }
  } catch (_) {}
}

// ===== Timer UI =====
let timerHandle = null;
let timerStartAt = 0;

function ensureTimerUI() {
  timerOuterEl = document.getElementById("timerOuter");
  timerInnerEl = document.getElementById("timerInner");
  timerTextEl = document.getElementById("timerText");
}

function stopTimer() {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
  }
}

function setTimerBarStyleByRemain(remainMs) {
  if (!timerInnerEl) return;
  if (remainMs <= WARN_AT_SEC * 1000) {
    timerInnerEl.style.filter = "brightness(1.25)";
  } else {
    timerInnerEl.style.filter = "";
  }
}

function startTimerForQuestion() {
  stopTimer();
  ensureTimerUI();

  const totalMs = QUESTION_TIME_SEC * 1000;
  timerStartAt = Date.now();

  const tick = () => {
    const elapsed = Date.now() - timerStartAt;
    const remain = Math.max(0, totalMs - elapsed);

    if (timerTextEl) timerTextEl.textContent = `${(remain / 1000).toFixed(1)}s`;
    if (timerInnerEl) {
      timerInnerEl.style.width = `${(remain / totalMs) * 100}%`;
      setTimerBarStyleByRemain(remain);
    }

    if (remain <= 0) {
      stopTimer();
      onTimeUp();
    }
  };

  tick();
  timerHandle = setInterval(tick, 100);
}

function triggerTimeUpScanlineOnce() {
  const el = document.createElement("div");
  el.className = "timeup-scanline";
  document.body.appendChild(el);
  setTimeout(() => {
    try { el.remove(); } catch (_) {}
  }, 600);
}

function onTimeUp() {
  if (locked) return;

  locked = true;
  disableChoices(true);

  const q = order[index];
  const inputRaw = answerInput ? answerInput.value : "";
  const input = normalizeYomi(inputRaw);

  history.push({
    q,
    inputRaw,
    inputNorm: input,
    candidates: [normalizeYomi(q.answer)].filter(Boolean),
    isCorrect: false,
    isTimeUp: true,
  });

  // combo は確実に切る
  combo = 0;

  updateMeterUI();
  updateScoreUI();

  // 走査線
  triggerTimeUpScanlineOnce();

  updateStatusUI(`TIME UP（正解：${q.answer}）`, { glitch: true });

  if (nextBtn) nextBtn.disabled = false;
  pulseNext();
}

// ===== Core =====
function render() {
  const q = order[index];

  if (progressEl) progressEl.textContent = `第${index + 1}問 / ${order.length}`;
  updateScoreUI();
  updateModeUI();
  updateMeterUI();

  const text = q.source ? `${q.question}（${q.source}）` : q.question;
  if (questionEl) questionEl.innerHTML = highlightBrackets(text);

  if (sublineEl) sublineEl.textContent = "";

  // 入力UI
  if (answerInput) {
    answerInput.value = "";
    answerInput.disabled = false;
    // セッション開始直後の一拍後フォーカス（スマホでの表示崩れ回避）
    setTimeout(() => {
      try { answerInput.focus(); } catch (_) {}
    }, 0);
  }
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.classList.remove("correct", "wrong");
  }

  // ステータスは空
  if (statusEl) statusEl.textContent = "";

  if (nextBtn) nextBtn.disabled = true;
  locked = false;

  startTimerForQuestion();
}

function startWithPool(pool) {
  order = pool.slice();
  if (!previewAll) shuffle(order);

  if (mode === "normal") order = order.slice(0, TOTAL_QUESTIONS);

  index = 0;
  score = 0;
  combo = 0;
  maxCombo = 0;
  locked = false;
  wrongOnlyRetried = false;
  history = [];

  render();
}

function startNewSession() {
  startWithPool(questions);
}

function retryWrongOnlyOnce() {
  const wrong = history.filter((h) => !h.isCorrect).map((h) => h.q);
  if (!wrong.length) {
    startNewSession();
    return;
  }
  startWithPool(wrong);
}

function judge() {
  if (locked) return;
  locked = true;

  stopTimer();

  disableChoices(true);

  const q = order[index];
  const inputRaw = answerInput ? answerInput.value : "";
  const input = normalizeYomi(inputRaw);

  const candidates = [q.answer]
    .concat(q.alt ? q.alt.split("|") : [])
    .map((s) => normalizeYomi(s))
    .filter(Boolean);

  const isCorrect = input.length > 0 && candidates.includes(input);

  history.push({ q, inputRaw, inputNorm: input, candidates, isCorrect, isTimeUp: false });

  if (isCorrect) {
    score++;
    combo++;
    if (combo > maxCombo) maxCombo = combo;

    if (submitBtn) submitBtn.classList.add("correct");
    flashGood();
    playSE("correct");
    updateStatusUI("正解");
  } else {
    combo = 0;
    if (submitBtn) submitBtn.classList.add("wrong");
    shakeBad();
    playSE("wrong");
    // 仕様：解答は【】内のみ。正解は短いので出して学習効率を上げる
    updateStatusUI(`不正解（正解：${q.answer}）`);
  }

  updateScoreUI();
  updateMeterUI();

  if (nextBtn) nextBtn.disabled = false;
  pulseNext();
}

function getUserMessageByRate(rate) {
  if (rate >= 95) return "完璧です。知識が仕上がっています。";
  if (rate >= 80) return "とても良いです。弱点だけ潰しましょう。";
  if (rate >= 60) return "合格圏。間違いを復習すれば伸びます。";
  if (rate >= 40) return "基礎固めの途中。復習の量で勝てます。";
  return "ここから伸びます。反復で定着させましょう。";
}

function calcStars(score, total) {
  const rate = score / Math.max(1, total);
  if (rate >= 0.95) return 5;
  if (rate >= 0.85) return 4;
  if (rate >= 0.70) return 3;
  if (rate >= 0.50) return 2;
  if (rate >= 0.30) return 1;
  return 0;
}

function calcRankName(stars, maxCombo) {
  if (stars >= 5 && maxCombo >= 8) return "S+";
  if (stars >= 5) return "S";
  if (stars >= 4) return "A";
  if (stars >= 3) return "B";
  if (stars >= 2) return "C";
  return "D";
}

function buildReviewHtml() {
  const wrong = history.filter((h) => !h.isCorrect);
  if (!wrong.length) {
    return `
      <div class="review">
        <div class="rv-item">全問正解。復習項目はありません。</div>
      </div>
    `;
  }

  const items = wrong
    .map((h, idx) => {
      const q = h.q;
      const qText = q.source ? `${q.question}（${q.source}）` : q.question;
      const user = escapeHtml(String(h.inputRaw ?? ""));
      const ans = escapeHtml(String(q.answer ?? ""));
      const alt = String(q.alt ?? "").trim();
      const altHtml = alt
        ? `<div class="rv-choice" style="opacity:.85;">別解：${escapeHtml(alt)}</div>`
        : "";

      return `
        <div class="rv-item">
          <div class="rv-q">#${idx + 1} ${highlightBrackets(qText)}</div>
          <div class="rv-choices">
            <div class="rv-choice is-selected">あなたの入力：${user || "（未入力）"}</div>
            <div class="rv-choice is-correct">正解：${ans}</div>
            ${altHtml}
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="review">
      <div style="opacity:.9;margin-bottom:6px;">復習（間違いのみ ${wrong.length} 件）</div>
      ${items}
    </div>
  `;
}

let resultOverlay = null;

function ensureResultOverlay() {
  if (resultOverlay) return resultOverlay;

  const wrap = document.createElement("div");
  wrap.className = "result-overlay";
  wrap.innerHTML = `
    <div class="result">
      <div class="result-head">
        <div class="result-title">RESULT</div>
        <div class="result-close" id="resultClose">CLOSE</div>
      </div>
      <div class="result-body">
        <div class="stars" id="starsRow"></div>
        <div class="rank" id="rankTitle"></div>
        <div class="rate" id="rateText"></div>
        <div class="summary" id="resultSummary"></div>
        <div class="details" id="resultDetails"></div>
        <div class="review" id="reviewArea"></div>
        <div class="result-actions">
          <button class="ra" id="resultRetryWrong">間違いだけ復習</button>
          <button class="ra" id="resultRestart">最初から</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  resultOverlay = wrap;

  const resultBtnCloseEl = document.getElementById("resultClose");
  const resultBtnRestartEl = document.getElementById("resultRestart");
  const resultBtnRetryWrongEl = document.getElementById("resultRetryWrong");
  const starsRow = document.getElementById("starsRow");
  const rankTitleEl = document.getElementById("rankTitle");
  const rateEl = document.getElementById("rateText");
  const resultSummaryEl = document.getElementById("resultSummary");
  const resultDetailsEl = document.getElementById("resultDetails");
  const reviewEl = document.getElementById("reviewArea");

  const hide = () => {
    resultOverlay.classList.remove("show");
  };

  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) hide();
  });

  if (resultBtnCloseEl) resultBtnCloseEl.addEventListener("click", hide);

  if (resultBtnRestartEl) {
    resultBtnRestartEl.addEventListener("click", async () => {
      hide();
      await unlockAudioOnce();
      startNewSession();
    });
  }

  if (resultBtnRetryWrongEl) {
    resultBtnRetryWrongEl.addEventListener("click", async () => {
      hide();
      await unlockAudioOnce();
      if (wrongOnlyRetried) return;
      wrongOnlyRetried = true;
      retryWrongOnlyOnce();
    });
  }

  resultOverlay._set = ({ stars, rankName, percent, summary, details, reviewHtml, canRetryWrong }) => {
    if (resultBtnRetryWrongEl) {
      resultBtnRetryWrongEl.disabled = !canRetryWrong;
      resultBtnRetryWrongEl.style.opacity = canRetryWrong ? "" : "0.45";
    }
    if (rankTitleEl) rankTitleEl.textContent = `評価：${rankName}`;
    if (rateEl) rateEl.textContent = `${percent}%`;
    if (resultSummaryEl) resultSummaryEl.textContent = summary;
    if (resultDetailsEl) resultDetailsEl.innerHTML = details;
    if (reviewEl) reviewEl.innerHTML = reviewHtml;

    const starEls = starsRow ? Array.from(starsRow.querySelectorAll(".st")) : [];
    if (starsRow) starsRow.innerHTML = "";

    for (let i = 0; i < 5; i++) {
      const on = i < stars;
      const s = document.createElement("div");
      s.className = "st";
      s.textContent = on ? "★" : "☆";
      starsRow.appendChild(s);
    }
  };

  return resultOverlay;
}

function showResultOverlay() {
  ensureResultOverlay();

  // total は history.length を使う（時間切れも含む）
  const total = (history && history.length) ? history.length : (order.length || 1);

  const percent = Math.round((score / total) * 100);
  const stars = calcStars(score, total);
  const rank = calcRankName(stars, maxCombo);
  const message = getUserMessageByRate(percent);
  const canRetryWrong = history.some((h) => !h.isCorrect);
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

  const reviewHtml = mode === "endless" ? buildReviewHtml() : "";

  resultOverlay._set({
    stars,
    rankName: rank,
    percent,
    summary: message,
    details,
    reviewHtml,
    canRetryWrong: mode === "endless" ? canRetryWrong : false,
  });

  resultOverlay.classList.add("show");
}

function finish() {
  stopTimer();

  if (progressEl) progressEl.textContent = "終了";
  disableChoices(true);
  if (nextBtn) nextBtn.disabled = true;

  if (questionEl) questionEl.textContent = `結果：${score} / ${order.length}`;
  if (sublineEl) sublineEl.textContent = "";
  if (statusEl) statusEl.textContent = "おつかれさまでした。";

  showResultOverlay();
}

function setMode(next) {
  mode = next === "endless" ? "endless" : "normal";
  StorageAdapter.set(STORAGE_KEY_LAST_MODE, mode);
  updateModeUI();
}

async function beginFromStartScreen(opt = {}) {
  if (opt.countdown) await runCountdown();
  try {
    if (startScreenEl) startScreenEl.style.display = "none";
  } catch (_) {}
  if (quizEl) quizEl.style.display = "";

  await unlockAudioOnce();

  // BGM on?
  const bgmOn = StorageAdapter.get(STORAGE_KEY_BGM_ON) === "1";
  setBgm(bgmOn);

  startNewSession();
}

function canBeginNow() {
  return questions && questions.length > 0;
}

// ===== Error UI =====
function showError(e) {
  console.error(e);
  if (questionEl) questionEl.textContent = "エラーが発生しました。";
  if (sublineEl) sublineEl.textContent = "";
  if (statusEl) statusEl.textContent = String(e && e.message ? e.message : e);
}

// ===== Events =====
if (submitBtn) {
  submitBtn.addEventListener("click", async () => {
    await unlockAudioOnce();
    judge();
  });
}

if (answerInput) {
  answerInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await unlockAudioOnce();
      judge();
    }
  });
}

if (nextBtn) {
  nextBtn.addEventListener("click", () => {
    index++;
    if (index >= order.length) finish();
    else render();
  });
}

if (restartBtn) {
  restartBtn.addEventListener("click", async () => {
    await unlockAudioOnce();
    startNewSession();
  });
}

if (bgmToggleEl) {
  bgmToggleEl.addEventListener("click", async () => {
    await unlockAudioOnce();
    const on = StorageAdapter.get(STORAGE_KEY_BGM_ON) === "1";
    setBgm(!on);
  });
}

if (modeNormalBtn) {
  modeNormalBtn.addEventListener("click", async (e) => {
    // links already include params; no-op
  });
}
if (modeEndlessBtn) {
  modeEndlessBtn.addEventListener("click", async (e) => {
    // links already include params; no-op
  });
}

// ===== Boot =====
let history = [];

(async function boot() {
  try {
    if (URL_MODE === "endless" || URL_MODE === "normal") setMode(URL_MODE);
    else setMode("normal");

    if (!window.CSVUtil || typeof window.CSVUtil.load !== "function") {
      throw new Error("CSVUtil が見つかりません（csv.js の読み込み順/内容を確認）");
    }

    // ✅ 旧キー救済（必要なら1回だけ）
    migrateCardCountsIfNeeded();

    const baseUrl = new URL("./", location.href).toString();
    const csvUrl = new URL("questions.csv", baseUrl).toString();

    if (progressEl) progressEl.textContent = "読み込み中…";
    if (startBtnEl) {
      startBtnEl.disabled = true;
      startBtnEl.textContent = "読み込み中…";
    }

    const raw = await window.CSVUtil.load(csvUrl);
    questions = raw.map(normalizeRow);

    try {
      const cardsUrl = new URL("cards.csv", baseUrl).toString();
      const rawCards = await window.CSVUtil.load(cardsUrl);

      const nextCards = [];
      for (const r of rawCards) {
        try {
          const c = normalizeCardRow(r);
          if (c.id) nextCards.push(c);
          else console.warn("[cards.csv] skip: empty id row", r);
        } catch (e) {
          console.warn("[cards.csv] skip: normalize failed", e, r);
        }
      }

      cardsAll = nextCards;
      rebuildCardPoolsFromCsv();
      validateCardsCsv();
    } catch (e) {
      console.warn("[cards.csv] load/validate failed (fallback to empty).", e);
      cardsAll = [];
      cardPoolByRarity = { 3: [], 4: [], 5: [] };
    }

    if (progressEl) progressEl.textContent = `準備完了（問題数 ${questions.length}）`;
    updateScoreUI();
    updateModeUI();
    if (meterLabel) meterLabel.textContent = `進捗 0/0`;
    if (comboLabel) comboLabel.textContent = `最大COMBO x0`;
    if (meterInner) meterInner.style.width = `0%`;

    if (questionEl) questionEl.textContent = "始めたいメニューを選んでください。";
    if (sublineEl) sublineEl.textContent = "";
    if (statusEl) statusEl.textContent = "";

    disableChoices(true);
    if (nextBtn) nextBtn.disabled = true;

    // タイムバーは待機表示（消えない）
    ensureTimerUI();
    if (timerTextEl) timerTextEl.textContent = `${QUESTION_TIME_SEC.toFixed(0)}.0s`;
    if (timerInnerEl) {
      timerInnerEl.style.width = "100%";
      setTimerBarStyleByRemain(QUESTION_TIME_SEC * 1000);
    }

    if (startBtnEl) {
      startBtnEl.disabled = false;
      startBtnEl.textContent = "START";
    }
    if (startNoteEl) {
      startNoteEl.textContent = "BGMは開始後にONにできます。";
    }

    ensureResultOverlay();

    if (URL_AUTOSTART) {
      try {
        await beginFromStartScreen({ countdown: true });
      } catch (e) {
        console.warn("autostart failed", e);
      }
    }
  } catch (e) {
    showError(e);
  }
})();

})();
