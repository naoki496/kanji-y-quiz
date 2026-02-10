// collection.js（完成版：ロック＋preview＋rarity＋詳細＋枠色）

const STORAGE_KEY_CARD_COUNTS = "kobunQuiz.v1.cardCounts";

let ALL_CARDS = [];

// URL params
const params = new URLSearchParams(location.search);
const previewAll = params.get("preview") === "1";
const debugMode  = params.get("debug") === "1";

// ----------------------------
// Load owned counts
// ----------------------------
function loadCounts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CARD_COUNTS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// ----------------------------
// Normalize CSV row
// ----------------------------
function normalizeCardRow(r) {
  return {
    id: String(r.id ?? "").trim(),
    rarity: Number(r.rarity) || 0,
    name: String(r.name ?? "").trim(),
    img: String(r.img ?? "").trim(),
    wiki: String(r.wiki ?? "").trim(),
  };
}

// ----------------------------
// Resolve image path
// ----------------------------
function resolveCardImgPath(p) {
  p = String(p ?? "").trim();
  if (!p) return "";
  if (p.includes("/") || p.startsWith("http")) return p;
  return `assets/cards/${p}`;
}

// ----------------------------
// Main render
// ----------------------------
function renderCollection() {
  const grid = document.getElementById("cardGrid");
  if (!grid) return;

  const counts = loadCounts();
  grid.innerHTML = "";

  ALL_CARDS.forEach((card) => {
    const owned = counts[card.id] ?? 0;
    const unlocked = previewAll ? true : owned > 0;

    // ✅枠クラス（rarity別）
    const item = document.createElement("div");
    item.className = unlocked
      ? `card-item rarity-${card.rarity}`
      : "card-item card-locked";

    if (unlocked) {
      // ----------------------------
      // Unlocked card
      // ----------------------------
      const link = document.createElement("a");
      link.className = "card-link";

      if (card.wiki) {
        link.href = card.wiki;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      } else {
        link.href = "#";
      }

      // Image
      const img = document.createElement("img");
      img.src = resolveCardImgPath(card.img);
      img.alt = card.name;

      // Name
      const name = document.createElement("div");
      name.className = "card-item-name";
      name.textContent = card.name;

      // ★ Rarity text
      const rar = document.createElement("div");
      rar.className = "card-item-rarity";
      rar.textContent = "★".repeat(card.rarity || 0);

      // Owned count
      const cnt = document.createElement("div");
      cnt.className = "card-item-count";
      cnt.textContent = `所持：${owned}`;

      // ▶ Detail
      const detail = document.createElement("div");
      detail.className = "card-item-detail";
      detail.textContent = card.wiki ? "▶詳細を見る" : "";

      // Append
      link.appendChild(img);
      link.appendChild(name);
      link.appendChild(rar);
      link.appendChild(cnt);
      if (card.wiki) link.appendChild(detail);

      item.appendChild(link);

    } else {
      // ----------------------------
      // Locked card
      // ----------------------------
      const locked = document.createElement("div");
      locked.className = "locked-img";

      const name = document.createElement("div");
      name.className = "card-item-name";
      name.textContent = "？？？";

      const hint = document.createElement("div");
      hint.className = "card-hint";
      hint.textContent = "未入手";

      item.appendChild(locked);
      item.appendChild(name);
      item.appendChild(hint);
    }

    grid.appendChild(item);
  });

  // ✅debugボタン
  if (debugMode) {
    const btn = document.createElement("button");
    btn.textContent = "全カード解放（デバッグ）";
    btn.style.marginTop = "14px";

    btn.onclick = () => {
      const fake = {};
      ALL_CARDS.forEach((c) => (fake[c.id] = 1));
      localStorage.setItem(STORAGE_KEY_CARD_COUNTS, JSON.stringify(fake));
      alert("全カードを解放しました（端末内のみ）");
      location.reload();
    };

    grid.appendChild(btn);
  }
}

// ----------------------------
// Load CSV
// ----------------------------
async function loadCardsCSV() {
  const rows = await CSVUtil.load("./cards.csv");
  ALL_CARDS = rows.map(normalizeCardRow);
}

// ----------------------------
// Init
// ----------------------------
(async () => {
  await loadCardsCSV();
  renderCollection();
})();
