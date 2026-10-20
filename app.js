const state = {
  entries: new Map(),
  searchText: new Map(),
  catalog: [],
  activeId: null,
  year: "all",
  query: "",
  searchIds: null,
  view: "list",
  calY: new Date().getFullYear(),
  calM: new Date().getMonth(),
  calDate: "",
  gallery: [],
  galleryIndex: 0,
};

const $ = (id) => document.getElementById(id);
let searchToken = 0;
let previewUrls = [];

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function unescapeMd(value) {
  return String(value).replace(/\\(.)/g, "$1");
}

function todayISO() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function formatMeta(entry) {
  if (!entry.date) return "开篇";
  const [year, month, day] = entry.date.split("-").map(Number);
  const week = "日一二三四五六"[new Date(year, month - 1, day).getDay()];
  let text = `${year}年${month}月${day}日 · 星期${week}`;
  if (entry.time) text += ` · ${entry.time}`;
  return text;
}

function inline(raw) {
  const source = unescapeMd(raw);
  const re = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+?)\*\*/g;
  let html = "";
  let last = 0;
  let match;
  while ((match = re.exec(source))) {
    html += escapeHtml(source.slice(last, match.index));
    if (match[0].startsWith("!")) {
      const src = safeImage(match[2]);
      if (src) html += `<img src="${escapeHtml(src)}" alt="${escapeHtml(match[1])}" loading="lazy">`;
    } else if (match[3] !== undefined) {
      const href = match[4].trim();
      if (/^https?:\/\//i.test(href)) {
        html += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(match[3])}</a>`;
      } else {
        html += escapeHtml(match[3]);
      }
    } else {
      html += `<strong>${escapeHtml(match[5])}</strong>`;
    }
    last = match.index + match[0].length;
  }
  html += escapeHtml(source.slice(last));
  return html;
}

function safeImage(src) {
  const value = src.trim();
  if (
    value.startsWith("Images_attachments/") ||
    value.startsWith("uploads/") ||
    value.startsWith("data:image/") ||
    /^https?:\/\//i.test(value)
  ) {
    return value;
  }
  return "";
}

function metaOf(entry) {
  const markdown = entry.markdown || "";
  const plain = markdown
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/[#>*_]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    id: entry.id,
    date: entry.date || "",
    time: entry.time || "",
    title: entry.title || "无题",
    excerpt: plain.slice(0, 160),
    pinned: Boolean(entry.pinned),
    images: (markdown.match(/!\[[^\]]*\]\(/g) || []).length,
    seq: entry.seq || 0,
    user: Boolean(entry.user),
  };
}

function compareEntries(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const aTimed = a.time ? 1 : 0;
  const bTimed = b.time ? 1 : 0;
  if (aTimed !== bTimed) return bTimed - aTimed;
  if ((a.time || "") !== (b.time || "")) return a.time < b.time ? 1 : -1;
  return (a.seq || 0) - (b.seq || 0);
}

function rememberEntry(entry) {
  state.entries.set(entry.id, entry);
  state.searchText.set(
    entry.id,
    `${entry.title || ""}\n${entry.markdown || ""}`.replace(/!\[[^\]]*\]\([^)]+\)/g, " ").toLowerCase()
  );
}

function rebuildCatalog() {
  const items = [...state.entries.values()].map(metaOf);
  const pinned = items.filter((item) => item.pinned);
  const rest = items.filter((item) => !item.pinned).sort(compareEntries);
  state.catalog = pinned.concat(rest);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("lianyaoshi-diary", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("entries")) db.createObjectStore("entries", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadUserEntries() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction("entries", "readonly").objectStore("entries").getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (_) {
    return [];
  }
}

async function saveUserEntry(entry) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("entries", "readwrite");
    tx.objectStore("entries").put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function removeUserEntry(id) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("entries", "readwrite");
    tx.objectStore("entries").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function deriveTitle(title, body) {
  const cleaned = title.replace(/\s+/g, " ").trim();
  if (cleaned) return cleaned.slice(0, 120);
  for (const line of body.split("\n")) {
    const text = line.replace(/[#>*_]+/g, "").trim();
    if (text && !text.startsWith("![")) return text.slice(0, 40);
  }
  return "无题";
}

function headingHtml(text) {
  const clean = unescapeMd(text).replace(/\*/g, "").replace(/\s+/g, " ").trim();
  const numbered = clean.match(/^(0\d|\d{1,2})\s+(.*)$/) || clean.match(/^(0\d)(\S.*)$/);
  if (numbered && Number(numbered[1]) <= 30 && !/^19\d{2}|^20\d{2}/.test(clean)) {
    return `<span class="num">${escapeHtml(numbered[1])}</span>${escapeHtml(numbered[2])}`;
  }
  return escapeHtml(clean);
}

function flowDiagram() {
  const tag = (text) => `<div class="tag">${text}</div>`;
  const arr = (extra = "") => `<div class="arr ${extra}"><i></i></div>`;
  const node = (cls, html) => `<div class="node ${cls}">${html}</div>`;
  const bubble = `${node("asset", "若集中追逐股票、房地产")}
    ${arr()}
    ${node("end asset", "<strong>资产价格上涨</strong><span>可能形成泡沫</span>")}`;
  return `<figure class="flow">
    <figcaption>央行放水后的资金去向与政策效果</figcaption>
    <div class="flow-top">
      ${node("", "央行放水：降息、购买资产等")}
      ${arr()}
      ${node("", "货币与信贷传导")}
    </div>
    <div class="flow-gate">
      <div class="gate-col">
        ${tag("传导受阻")}
        ${arr()}
        ${node("", "资金需求弱、银行惜贷<br>或居民企业还债")}
        ${arr()}
        ${node("end", "<strong>刺激效果有限</strong>")}
      </div>
      <div class="gate-col pass-col">
        ${tag("传导成功")}
        <div class="pass-elbow" aria-hidden="true"><i></i></div>
        ${arr("long")}
      </div>
    </div>
    ${node("judge absorb", "实体经济吸纳能力如何？")}
    <div class="fork3">
      <div class="bar" aria-hidden="true"></div>
      <section class="col real">
        ${tag("较强")}
        ${arr()}
        ${node("real", "投资、生产、就业<br>与消费")}
        ${arr()}
        ${node("end real", "<strong>收入与需求增长</strong><span>可能推升物价</span>")}
      </section>
      <div class="rest">
        ${tag("较弱")}
        ${arr()}
        ${node("judge", "资本项目开放程度？")}
        <div class="two">
          <div class="col mid">
            ${tag("受限")}
            ${arr()}
            ${node("asset", "资金更倾向留在国内")}
            <div class="recv d-only" aria-hidden="true"></div>
            <div class="d-only">${bubble}</div>
            <div class="m-only">${arr()}${bubble}</div>
          </div>
          <div class="col out-col">
            ${tag("开放")}
            ${arr()}
            ${node("judge", "实际资本流向？")}
            <div class="to-mid d-only"><i></i><b>留在国内／净流入</b></div>
            <div class="m-only">
              ${tag("留在国内／净流入")}
              ${arr()}
              ${bubble}
            </div>
            ${tag("净流出")}
            ${arr()}
            ${node("out", "本币承受贬值压力<span>刺激可能向海外溢出</span>")}
            ${tag("折算")}
            ${arr()}
            ${node("judge", "本币M2增长与汇率变化")}
            <div class="pair m2-pair">
              <div class="m2-up">
                ${node("end out", "<strong>美元计价<br>M2上升</strong>")}
              </div>
              <div class="m2-down">
                ${node("out", "<strong>美元计价<br>M2下降</strong><span>本币M2的美元折算价值下降</span>")}
                ${arr()}
              </div>
            </div>
            ${node("out", "若伴随美元债偿付压力上升、美元融资趋紧，或央行为稳汇率而收紧")}
            ${arr()}
            ${node("end out", "<strong>国内金融条件可能收紧</strong><span>抵消部分放水效果</span>")}
          </div>
        </div>
      </div>
    </div>
    <p class="foot">依据原文机制整理；各路径均为条件性结果，美元折算变化不等同于国内货币紧缩。</p>
  </figure>`;
}

function renderMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const image = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      const src = safeImage(image[2]);
      if (src && src.includes("monetary-policy-flow")) {
        html.push(flowDiagram());
      } else if (src) {
        html.push(`<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(unescapeMd(image[1]))}" loading="lazy"></figure>`);
      }
      index += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const tag = level <= 2 ? "h2" : level === 3 ? "h3" : "h4";
      html.push(`<${tag}>${headingHtml(heading[2])}</${tag}>`);
      index += 1;
      continue;
    }

    if (/^\*\*\d{1,2}\*\*/.test(trimmed) && trimmed.length < 80) {
      html.push(`<h3>${headingHtml(trimmed)}</h3>`);
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      html.push("<hr>");
      index += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quote = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        const text = lines[index].trim().replace(/^>\s?/, "");
        if (text) quote.push(`<p>${inline(text)}</p>`);
        index += 1;
      }
      html.push(`<blockquote>${quote.join("")}</blockquote>`);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(`<li>${inline(lines[index].trim().replace(/^[-*]\s+/, ""))}</li>`);
        index += 1;
      }
      html.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(`<li>${inline(lines[index].trim().replace(/^\d+\.\s+/, ""))}</li>`);
        index += 1;
      }
      html.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    html.push(`<p>${inline(trimmed)}</p>`);
    index += 1;
  }
  return html.join("\n");
}

function datedEntries() {
  return state.catalog.filter((entry) => entry.date && !entry.pinned);
}

function visibleEntries() {
  let items = state.catalog.filter((entry) => !entry.pinned);
  if (state.query) {
    if (state.searchIds) items = items.filter((entry) => state.searchIds.has(entry.id));
    const needle = state.query.toLowerCase();
    return items.filter((entry) => (
      state.searchIds
        ? true
        : `${entry.title}\n${entry.excerpt}`.toLowerCase().includes(needle)
    ));
  }
  if (state.year !== "all") items = items.filter((entry) => entry.date.startsWith(state.year));
  return items;
}

function renderYears() {
  const years = [...new Set(datedEntries().map((entry) => entry.date.slice(0, 4)))].sort().reverse();
  const buttons = [`<button type="button" data-year="all"${state.year === "all" ? ' class="on"' : ""}>全部</button>`];
  for (const year of years) {
    buttons.push(`<button type="button" data-year="${year}"${state.year === year ? ' class="on"' : ""}>${year}</button>`);
  }
  $("years").innerHTML = buttons.join("");
  $("years").hidden = Boolean(state.query) || state.view === "calendar";
}

function entryButton(entry, showMonth) {
  const day = entry.pinned ? "框" : entry.date ? String(Number(entry.date.slice(8))) : "篇";
  const bits = [];
  if (entry.time) bits.push(entry.time);
  if (entry.images) bits.push(`${entry.images} 图`);
  const sub = showMonth && entry.date
    ? `<small class="ym">${Number(entry.date.slice(5, 7))}月</small>`
    : "";
  return `<button type="button" class="entry${entry.id === state.activeId ? " active" : ""}" data-id="${escapeHtml(entry.id)}">
    <span class="day">${day}${sub}</span>
    <span>
      <span class="title">${escapeHtml(entry.title)}</span>
      ${bits.length ? `<span class="meta-line">${escapeHtml(bits.join(" · "))}</span>` : ""}
    </span>
  </button>`;
}

function renderList() {
  const list = $("list");
  if (state.view === "calendar") {
    renderCalendar(list);
    return;
  }
  const pinned = state.query
    ? state.catalog.filter((entry) => entry.pinned && state.searchIds && state.searchIds.has(entry.id))
    : state.catalog.filter((entry) => entry.pinned);
  const items = visibleEntries();
  if (!pinned.length && !items.length) {
    list.innerHTML = `<div class="empty-note">${state.query ? "没有找到相关日记" : "这一年还没有日记"}</div>`;
    return;
  }
  const html = [];
  if (pinned.length && !state.query) {
    html.push(`<div class="pin-label">开篇</div>`);
    html.push(pinned.map((entry) => entryButton(entry, false)).join(""));
  }
  const showMonth = Boolean(state.query) || state.year === "all";
  let lastKey = "";
  for (const entry of items) {
    const key = entry.date ? entry.date.slice(0, 7) : "未注日期";
    if (key !== lastKey) {
      lastKey = key;
      const [year, month] = key.split("-");
      const label = state.year !== "all" && !state.query ? `${Number(month)}月` : `${year}年${Number(month)}月`;
      html.push(`<div class="month-label">${label}</div>`);
    }
    html.push(entryButton(entry, showMonth));
  }
  if (pinned.length && state.query) {
    html.unshift(pinned.map((entry) => entryButton(entry, false)).join(""));
  }
  list.innerHTML = html.join("");
}

function entriesOn(date) {
  return state.catalog.filter((entry) => entry.date === date);
}

function renderCalendar(list) {
  const first = new Date(state.calY, state.calM, 1);
  const start = (first.getDay() + 6) % 7;
  const days = new Date(state.calY, state.calM + 1, 0).getDate();
  const today = todayISO();
  const cells = [];
  for (let i = 0; i < start; i += 1) cells.push(`<span></span>`);
  for (let day = 1; day <= days; day += 1) {
    const date = `${state.calY}-${String(state.calM + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const has = entriesOn(date).length > 0;
    const classes = ["day-cell"];
    if (has) classes.push("has");
    if (date === today) classes.push("today");
    if (date === state.calDate) classes.push("on");
    cells.push(`<button type="button" class="${classes.join(" ")}" data-date="${date}">${day}</button>`);
  }
  const selected = entriesOn(state.calDate);
  let extra = "";
  if (state.calDate && selected.length) {
    extra = `<div class="day-entries">${selected.map((entry) => (
      `<button type="button" data-id="${escapeHtml(entry.id)}" class="${entry.id === state.activeId ? "active" : ""}">${escapeHtml(entry.title)}</button>`
    )).join("")}</div>`;
  } else if (state.calDate) {
    extra = `<div class="cal-empty">${escapeHtml(formatMeta({ date: state.calDate }))}<br>这一天还没有日记<button type="button" id="writeThisDay">写这一天</button></div>`;
  }
  list.innerHTML = `<div class="calendar">
    <div class="cal-nav">
      <button type="button" id="calPrev" aria-label="上个月">‹</button>
      <strong>${state.calY}年${state.calM + 1}月</strong>
      <button type="button" id="calNext" aria-label="下个月">›</button>
    </div>
    <div class="weekdays">${"一二三四五六日".split("").map((day) => `<span>${day}</span>`).join("")}</div>
    <div class="days">${cells.join("")}</div>
    ${extra}
  </div>`;
  $("calPrev").onclick = () => shiftMonth(-1);
  $("calNext").onclick = () => shiftMonth(1);
  const write = $("writeThisDay");
  if (write) write.onclick = () => openComposer(state.calDate);
}

function shiftMonth(delta) {
  const next = new Date(state.calY, state.calM + delta, 1);
  state.calY = next.getFullYear();
  state.calM = next.getMonth();
  renderList();
}

function setView(view) {
  state.view = view;
  $("viewList").classList.toggle("on", view === "list");
  $("viewCal").classList.toggle("on", view === "calendar");
  $("viewList").setAttribute("aria-selected", String(view === "list"));
  $("viewCal").setAttribute("aria-selected", String(view === "calendar"));
  if (view === "calendar") {
    const current = state.catalog.find((entry) => entry.id === state.activeId);
    if (current && current.date) {
      const [year, month, day] = current.date.split("-").map(Number);
      state.calY = year;
      state.calM = month - 1;
      state.calDate = current.date;
      void day;
    }
  }
  renderYears();
  renderList();
}

function articleHtml(entry) {
  const count = (entry.markdown.match(/!\[[^\]]*\]\(/g) || []).length;
  const bits = [formatMeta(entry)];
  if (count) bits.push(`${count} 张图`);
  const remove = entry.user
    ? `<button type="button" class="danger-text" id="deleteBtn">删除这篇</button>`
    : "";
  return `<article class="page">
    <div class="eyebrow">${entry.pinned ? "开篇" : "深度日记"}</div>
    <h1>${escapeHtml(entry.title)}</h1>
    <div class="meta">${escapeHtml(bits.join("  ·  "))}</div>
    <div class="article">${renderMarkdown(entry.markdown)}</div>
    <div class="endmark">完</div>
    ${remove}
  </article>`;
}

async function openEntry(id, options = {}) {
  state.activeId = id;
  try {
    localStorage.setItem("diary-last", id);
  } catch (_) {
    /* ignore */
  }
  const known = state.catalog.find((entry) => entry.id === id);
  $("crumb").textContent = known ? `${known.date ? formatMeta(known) + "  " : ""}${known.title}` : "深度日记";
  document.title = known ? `${known.title} · 深度日记` : "炼药师的财经世界 · 深度日记";
  if (state.view === "list") markActive(id);
  else renderList();
  const reader = $("reader");
  if (!options.keepScroll) reader.scrollTop = 0;
  const entry = state.entries.get(id);
  if (!entry) {
    reader.innerHTML = `<p class="loading">这一篇没有找到。</p>`;
    return;
  }
  reader.innerHTML = articleHtml(entry);
  reader.scrollTop = 0;
  bindGallery(reader);
  const remove = $("deleteBtn");
  if (remove) {
    remove.onclick = async () => {
      if (!confirm("删除这篇新写的日记？原来的日记不会受影响。")) return;
      try {
        await removeUserEntry(id);
      } catch (_) {
        alert("没有删掉");
        return;
      }
      state.entries.delete(id);
      state.searchText.delete(id);
      rebuildCatalog();
      renderYears();
      renderList();
      const next = datedEntries()[0];
      if (next) openEntry(next.id);
      else {
        state.activeId = null;
        reader.innerHTML = `<p class="loading">目录空了。</p>`;
      }
    };
  }
  if (window.innerWidth <= 860) closeSidebar();
}

function markActive(id) {
  document.querySelectorAll(".entry.active, .day-entries button.active").forEach((node) => {
    node.classList.remove("active");
  });
  const node = document.querySelector(`.entry[data-id="${CSS.escape(id)}"]`);
  if (node) {
    node.classList.add("active");
    node.scrollIntoView({ block: "nearest" });
  }
}

function bindGallery(root) {
  const images = [...root.querySelectorAll("img")];
  images.forEach((image, index) => {
    image.addEventListener("click", () => openLightbox(images, index));
  });
}

function openLightbox(images, index) {
  state.gallery = images.map((image) => ({ src: image.currentSrc || image.src, alt: image.alt || "" }));
  state.galleryIndex = index;
  showSlide();
  $("lightbox").hidden = false;
}

function showSlide() {
  const slide = state.gallery[state.galleryIndex];
  if (!slide) return;
  $("lbImg").src = slide.src;
  $("lbImg").alt = slide.alt;
  $("lbCount").textContent = `${state.galleryIndex + 1} / ${state.gallery.length}`;
  const single = state.gallery.length < 2;
  $("lbPrev").hidden = single;
  $("lbNext").hidden = single;
}

function closeLightbox() {
  $("lightbox").hidden = true;
  $("lbImg").removeAttribute("src");
}

function shiftSlide(delta) {
  if (state.gallery.length < 2) return;
  state.galleryIndex = (state.galleryIndex + delta + state.gallery.length) % state.gallery.length;
  showSlide();
}

function openSidebar() {
  $("sidebar").classList.add("open");
  $("scrim").hidden = false;
}
function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("scrim").hidden = true;
}

function openComposer(date) {
  $("entryForm").reset();
  $("fieldDate").value = date || todayISO();
  $("formError").hidden = true;
  clearPreviews();
  $("modal").hidden = false;
  $("fieldTitle").focus();
  closeSidebar();
}

function closeComposer() {
  $("modal").hidden = true;
  clearPreviews();
}

function clearPreviews() {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls = [];
  $("previews").innerHTML = "";
}

function showPreviews(files) {
  clearPreviews();
  const box = $("previews");
  for (const file of files) {
    if (!file.type.startsWith("image/") && !/\.heic$/i.test(file.name)) continue;
    const url = URL.createObjectURL(file);
    previewUrls.push(url);
    const image = document.createElement("img");
    image.src = url;
    image.alt = file.name;
    box.appendChild(image);
  }
}

function refreshSearch(query) {
  searchToken += 1;
  if (!query) {
    state.searchIds = null;
  } else {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const ids = [];
    for (const [id, haystack] of state.searchText) {
      if (tokens.every((token) => haystack.includes(token))) ids.push(id);
    }
    state.searchIds = new Set(ids);
  }
  renderYears();
  renderList();
}

function selectDate(date) {
  state.calDate = date;
  const items = entriesOn(date);
  renderList();
  if (items.length) openEntry(items[0].id);
  else {
    state.activeId = null;
    $("crumb").textContent = formatMeta({ date });
    document.title = `${formatMeta({ date })} · 深度日记`;
    $("reader").innerHTML = `<div class="empty-day">
      <div class="eyebrow">这一天</div>
      <h2>还没有日记</h2>
      <button type="button" class="primary" id="writeEmpty">写这一天</button>
    </div>`;
    $("writeEmpty").onclick = () => openComposer(date);
    renderList();
  }
}

async function init() {
  const source = Array.isArray(window.DIARY) ? window.DIARY : [];
  if (!source.length) {
    $("reader").innerHTML = `<p class="loading">日记内容没有载入。请打开这个文件夹里的 index.html。</p>`;
    return;
  }
  source.forEach(rememberEntry);
  (await loadUserEntries()).forEach(rememberEntry);
  rebuildCatalog();
  const dated = datedEntries();
  let initial = null;
  try {
    initial = localStorage.getItem("diary-last");
  } catch (_) {
    initial = null;
  }
  if (!state.catalog.some((entry) => entry.id === initial)) initial = dated[0] && dated[0].id;
  const opening = state.catalog.find((entry) => entry.id === initial);
  state.year = opening && opening.date ? opening.date.slice(0, 4) : (dated[0] ? dated[0].date.slice(0, 4) : "all");
  renderYears();
  renderList();
  if (initial) openEntry(initial);
}

$("years").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-year]");
  if (!button) return;
  state.year = button.dataset.year;
  renderYears();
  renderList();
});

$("list").addEventListener("click", (event) => {
  const dateButton = event.target.closest("button[data-date]");
  if (dateButton) {
    selectDate(dateButton.dataset.date);
    return;
  }
  const entryButtonNode = event.target.closest("button[data-id]");
  if (entryButtonNode) openEntry(entryButtonNode.dataset.id);
});

$("viewList").onclick = () => setView("list");
$("viewCal").onclick = () => setView("calendar");
$("composeBtn").onclick = () => openComposer();
$("composeSide").onclick = () => openComposer();
$("menuBtn").onclick = openSidebar;
$("scrim").onclick = closeSidebar;

let searchTimer = 0;
$("search").addEventListener("input", () => {
  state.query = $("search").value.trim();
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => refreshSearch(state.query), 180);
});

$("entryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("formError");
  error.hidden = true;
  const body = $("fieldBody").value.trim();
  const title = $("fieldTitle").value.trim();
  const files = $("fieldImages").files;
  if (!body && !title && !files.length) {
    error.textContent = "写一点文字，或加一张图片。";
    error.hidden = false;
    return;
  }
  if (files.length > 20) {
    error.textContent = "一次最多 20 张图片。";
    error.hidden = false;
    return;
  }
  const save = $("saveBtn");
  save.disabled = true;
  save.textContent = "保存中…";
  try {
    const images = [];
    for (const file of files) {
      if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) {
        throw new Error("请使用 jpg、png、gif 或 webp 图片");
      }
      const url = await readAsDataURL(file);
      images.push(`![](${url})`);
    }
    const date = $("fieldDate").value;
    const entry = {
      id: `u-${date.replace(/-/g, "")}-${Date.now().toString(36)}`,
      date,
      time: $("fieldTime").value || "",
      title: deriveTitle(title, body),
      markdown: [body, ...images].filter(Boolean).join("\n\n"),
      pinned: false,
      seq: -Math.floor(Date.now() / 1000),
      user: true,
    };
    await saveUserEntry(entry);
    rememberEntry(entry);
    rebuildCatalog();
    state.query = "";
    $("search").value = "";
    state.searchIds = null;
    state.year = entry.date.slice(0, 4);
    closeComposer();
    setView("list");
    renderYears();
    renderList();
    openEntry(entry.id);
  } catch (err) {
    error.textContent = err && err.name === "QuotaExceededError"
      ? "图片太大，浏览器存不下。可以少传几张。"
      : (err.message || "没有保存");
    error.hidden = false;
  } finally {
    save.disabled = false;
    save.textContent = "保存";
  }
});

$("fieldImages").addEventListener("change", () => showPreviews($("fieldImages").files));
const drop = $("drop");
["dragenter", "dragover"].forEach((name) => {
  drop.addEventListener(name, (event) => {
    event.preventDefault();
    drop.classList.add("over");
  });
});
["dragleave", "drop"].forEach((name) => {
  drop.addEventListener(name, (event) => {
    event.preventDefault();
    drop.classList.remove("over");
  });
});
drop.addEventListener("drop", (event) => {
  const files = event.dataTransfer.files;
  if (!files || !files.length) return;
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  $("fieldImages").files = transfer.files;
  showPreviews(transfer.files);
});

document.querySelectorAll("[data-close]").forEach((node) => {
  node.addEventListener("click", closeComposer);
});

$("lbClose").onclick = closeLightbox;
$("lbPrev").onclick = () => shiftSlide(-1);
$("lbNext").onclick = () => shiftSlide(1);
$("lightbox").addEventListener("click", (event) => {
  if (event.target === $("lightbox")) closeLightbox();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!$("lightbox").hidden) closeLightbox();
    else if (!$("modal").hidden) closeComposer();
    else closeSidebar();
    return;
  }
  if (!$("lightbox").hidden && event.key === "ArrowRight") shiftSlide(1);
  if (!$("lightbox").hidden && event.key === "ArrowLeft") shiftSlide(-1);
});

init().catch(() => {
  $("reader").innerHTML = `<p class="loading">这一页没有打开。请直接双击文件夹里的 index.html。</p>`;
});
