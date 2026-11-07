/* Calorie Tracker — a single-page web app.
 * Barcodes: live camera scan (ZXing) + Open Food Facts lookup.
 * Meal + label photos: Claude API, using the user's own key (stored only in this browser).
 * All data lives in this browser's localStorage; use Settings → Export to back it up.
 */
(() => {
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r0 = (n) => Math.round(Number(n) || 0);
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(n) ? n : 0; };
const fmt = (n) => r0(n).toLocaleString();
const scale = (m, f) => ({ kcal: m.kcal * f, protein: m.protein * f, carbs: m.carbs * f, fat: m.fat * f });
const sum = (list) => list.reduce((t, e) => ({ kcal: t.kcal + (+e.kcal || 0), protein: t.protein + (+e.protein || 0), carbs: t.carbs + (+e.carbs || 0), fat: t.fat + (+e.fat || 0) }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------------- Storage ---------------- */
const PREFIX = "ct:";
const store = {
  get(k, d) { try { const v = localStorage.getItem(PREFIX + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch (e) { alert("Couldn't save — storage may be full."); } },
  del(k) { try { localStorage.removeItem(PREFIX + k); } catch {} },
};
const DEFAULT_GOALS = { kcal: 2000, protein: 120, carbs: 220, fat: 65 };
const DEFAULT_MODEL = "claude-sonnet-5-5";
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

let curDate = new Date();
let goals = { ...DEFAULT_GOALS, ...store.get("goals", {}) };
let products = store.get("products", {});
let entries = [];
const apiKey = () => store.get("apiKey", "");
const model = () => store.get("model", DEFAULT_MODEL) || DEFAULT_MODEL;

function loadDay() { entries = store.get("day:" + dayKey(curDate), []); render(); }
function saveDay() { store.set("day:" + dayKey(curDate), entries); }
function saveProducts() { store.set("products", products); }

/* ---------------- Render ---------------- */
const RING_C = 2 * Math.PI * 60;
function render() {
  const t = sum(entries);
  const today = dayKey(new Date());
  const k = dayKey(curDate);
  const y = new Date(); y.setDate(y.getDate() - 1);
  $("#dateLabel").textContent = k === today ? "Today" : k === dayKey(y) ? "Yesterday" : curDate.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  $("#nextDay").disabled = k >= today;

  const left = goals.kcal - t.kcal;
  $("#remain").textContent = fmt(Math.abs(left));
  $("#remainLbl").textContent = left >= 0 ? "kcal left" : "kcal over";
  const arc = $("#ringArc");
  arc.style.strokeDasharray = RING_C;
  arc.style.strokeDashoffset = RING_C * (1 - Math.min(1, t.kcal / (goals.kcal || 1)));
  arc.style.stroke = left < 0 ? "var(--warn)" : "var(--accent)";
  $("#eaten").textContent = `${fmt(t.kcal)} / ${fmt(goals.kcal)} kcal`;
  for (const [m, id] of [["protein", "p"], ["carbs", "c"], ["fat", "f"]]) {
    $(`#${id}Txt`).textContent = `${r0(t[m])} / ${r0(goals[m])}g`;
    $(`#${id}Bar`).style.width = Math.min(100, (t[m] / (goals[m] || 1)) * 100) + "%";
  }

  $("#countLbl").textContent = entries.length ? `${entries.length} item${entries.length > 1 ? "s" : ""}` : "";
  const TAG = { barcode: ["database", ""], label: ["label", ""], photo: ["estimate", "est"], manual: ["", ""] };
  $("#log").innerHTML = entries.length
    ? entries.map((e) => {
        const [tag, cls] = TAG[e.source] || ["", ""];
        return `<div class="entry">
          <div class="nm"><b>${esc(e.name)}${tag ? `<span class="tag ${cls}">${tag}</span>` : ""}</b>
            <span>${e.detail ? esc(e.detail) + " · " : ""}P ${r0(e.protein)} · C ${r0(e.carbs)} · F ${r0(e.fat)}</span></div>
          <div class="kc">${r0(e.kcal)}</div>
          <button class="del" data-id="${e.id}" aria-label="Remove ${esc(e.name)}">×</button>
        </div>`;
      }).join("")
    : `<div class="empty">Nothing logged yet. Scan a barcode or snap your meal.</div>`;

  const recent = Object.values(products).sort((a, b) => (b.used || 0) - (a.used || 0)).slice(0, 12);
  $("#quickCard").hidden = !recent.length;
  $("#quick").innerHTML = recent.map((p) => `<button class="pill" data-code="${esc(p.code)}">${esc(p.name)}</button>`).join("");

  renderWeek();
  $("#keyBanner").hidden = !!apiKey();
}

function renderWeek() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(curDate); d.setDate(d.getDate() - i);
    const k = dayKey(d);
    days.push({ d, k, kcal: k === dayKey(curDate) ? sum(entries).kcal : sum(store.get("day:" + k, [])).kcal });
  }
  const max = Math.max(goals.kcal, ...days.map((x) => x.kcal), 1);
  const cur = dayKey(curDate);
  $("#week").innerHTML = days.map((x) => `
    <div class="d ${x.k === cur ? "cur" : ""}">
      <div class="v">${x.kcal ? r0(x.kcal) : ""}</div>
      <div class="b ${!x.kcal ? "zero" : x.kcal > goals.kcal ? "over" : ""}" style="height:${Math.max(3, (x.kcal / max) * 62)}px"></div>
      <div class="l">${x.d.toLocaleDateString(undefined, { weekday: "narrow" })}</div>
    </div>`).join("");
}

function addEntries(list) {
  const at = new Date(curDate); const now = new Date();
  at.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
  for (const e of list) {
    entries.push({ id: newId(), name: e.name, detail: e.detail || "", source: e.source,
      kcal: r0(e.kcal), protein: r1(e.protein), carbs: r1(e.carbs), fat: r1(e.fat), at: at.toISOString() });
  }
  saveDay(); render(); closeSheet();
  if (navigator.vibrate) navigator.vibrate(15);
}

$("#log").addEventListener("click", (e) => {
  const b = e.target.closest(".del"); if (!b) return;
  const entry = entries.find((x) => x.id === b.dataset.id);
  if (entry && confirm(`Remove “${entry.name}”?`)) { entries = entries.filter((x) => x.id !== b.dataset.id); saveDay(); render(); }
});
$("#quick").addEventListener("click", (e) => { const p = e.target.closest(".pill"); if (p && products[p.dataset.code]) showProduct(products[p.dataset.code]); });
$("#prevDay").onclick = () => { curDate.setDate(curDate.getDate() - 1); loadDay(); };
$("#nextDay").onclick = () => { if (dayKey(curDate) < dayKey(new Date())) { curDate.setDate(curDate.getDate() + 1); loadDay(); } };
$("#keyBanner").onclick = () => openSettings();
$("#installBanner").onclick = () => { $("#installBanner").hidden = true; store.set("installTipSeen", true); };

/* ---------------- Sheet ---------------- */
const sheet = $("#sheet"), scrim = $("#scrim");
function openSheet(html) { sheet.innerHTML = html; scrim.classList.add("on"); sheet.classList.add("open"); sheet.scrollTop = 0; }
function closeSheet() { sheet.classList.remove("open"); scrim.classList.remove("on"); }
scrim.onclick = closeSheet;
sheet.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeSheet(); });
const head = (title, sub) => `<div class="sheet-head"><div><h2>${title}</h2>${sub ? `<p class="sub">${sub}</p>` : ""}</div><button class="icon-btn" data-close aria-label="Close">×</button></div>`;
const spinner = (t) => `<span class="spin"></span>${esc(t)}`;

/* ---------------- Images ---------------- */
function loadImage(file) {
  return new Promise((res, rej) => { const u = URL.createObjectURL(file); const im = new Image(); im.onload = () => res({ im, u }); im.onerror = () => rej(new Error("Couldn't open that image.")); im.src = u; });
}
/** Downscale to maxSide and return base64 JPEG (no data: prefix) plus a preview URL. */
async function prepImage(file, maxSide = 1280, quality = 0.8) {
  const { im, u } = await loadImage(file);
  const s = Math.min(1, maxSide / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
  c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
  URL.revokeObjectURL(u);
  const dataUrl = c.toDataURL("image/jpeg", quality);
  return { base64: dataUrl.split(",")[1], preview: dataUrl };
}

/* ---------------- Open Food Facts ---------------- */
function macrosFrom(n, suffix) {
  const g = (k) => { const v = n[k + suffix]; return v === undefined || v === "" || !isFinite(+v) ? undefined : +v; };
  let kcal = g("energy-kcal");
  if (kcal === undefined) { const kj = g("energy"); if (kj !== undefined) kcal = kj / 4.184; }
  if (kcal === undefined) return undefined;
  return { kcal, protein: g("proteins") ?? 0, carbs: g("carbohydrates") ?? 0, fat: g("fat") ?? 0 };
}
async function lookupBarcode(code) {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}?fields=product_name,brands,serving_size,serving_quantity,nutriments`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`The food database is unavailable right now (${res.status}).`);
  const j = await res.json();
  if (j.status !== 1 || !j.product) return null;
  const p = j.product, n = p.nutriments || {};
  const sq = +p.serving_quantity;
  return {
    code, name: (p.product_name || "").trim() || `Product ${code}`,
    brand: (p.brands || "").split(",")[0].trim() || "",
    servingLabel: p.serving_size || "", servingGrams: sq > 0 ? sq : undefined,
    per100: macrosFrom(n, "_100g"), perServing: macrosFrom(n, "_serving"),
    source: "off", used: Date.now(),
  };
}

/* ---------------- Claude API ---------------- */
async function claudeJSON(prompt, base64) {
  const key = apiKey();
  if (!key) throw new Error("Add your Claude API key in Settings first.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: model(), max_tokens: 2000,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
        { type: "text", text: prompt + "\n\nRespond with ONLY the JSON object, no other text." },
      ] }],
    }),
  });
  if (!res.ok) {
    let msg = await res.text();
    try { msg = JSON.parse(msg).error.message || msg; } catch {}
    if (res.status === 401) throw new Error("Your API key was rejected. Check it in Settings.");
    if (res.status === 429) throw new Error("Rate limited by the Claude API. Wait a moment and try again.");
    throw new Error(`Claude API error (${res.status}): ${String(msg).slice(0, 200)}`);
  }
  const j = await res.json();
  const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Couldn't understand the response. Try again.");
  return JSON.parse(m[0]);
}

/* ---------------- Barcode scanner ---------------- */
let scanControls = null, scanBusy = false;
async function openScanner() {
  $("#scanner").hidden = false; $("#scanCode").value = ""; setScanStatus("");
  scanBusy = false;
  if (!window.ZXingBrowser) { setScanStatus("Scanner failed to load. Type the number instead.", true); return; }
  try {
    const reader = new ZXingBrowser.BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 120 });
    scanControls = await reader.decodeFromConstraints(
      { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
      $("#video"),
      (result) => {
        if (!result || scanBusy) return;
        const code = String(result.getText()).replace(/\D/g, "");
        if (code.length >= 8) { if (navigator.vibrate) navigator.vibrate(40); handleCode(code); }
      },
    );
  } catch (e) {
    const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
    setScanStatus(denied ? "Camera access was blocked. Allow it in Settings → Safari → Camera (or the site's settings), or type the number." : "Couldn't start the camera. Type the number instead.", true);
  }
}
function closeScanner() {
  try { scanControls && scanControls.stop(); } catch {}
  scanControls = null; $("#scanner").hidden = true;
}
function setScanStatus(html, err) { const el = $("#scanStatus"); el.className = "status" + (err ? " err" : ""); el.innerHTML = html; }
$("#scanCancel").onclick = closeScanner;
$("#scanGo").onclick = () => { const c = $("#scanCode").value.replace(/\D/g, ""); if (c.length >= 6) handleCode(c); };
$("#scanCode").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#scanGo").click(); });
$("#actScan").onclick = openScanner;

async function handleCode(code) {
  if (scanBusy) return;
  scanBusy = true;
  if (products[code]) { closeScanner(); showProduct(products[code]); return; }
  setScanStatus(spinner("Looking up product…"));
  try {
    const p = await lookupBarcode(code);
    closeScanner();
    if (p && (p.per100 || p.perServing)) { products[code] = p; saveProducts(); showProduct(p); }
    else labelFlow(code, p ? p.name : "");
  } catch (e) {
    scanBusy = false;
    setScanStatus(esc(e.message) + " Check your connection and try again.", true);
  }
}

/* ---------------- Product (portion picker) ---------------- */
function showProduct(p) {
  const perServing = p.perServing || (p.per100 && p.servingGrams ? scale(p.per100, p.servingGrams / 100) : null);
  const perGram = p.per100 ? scale(p.per100, 0.01) : perServing && p.servingGrams ? scale(perServing, 1 / p.servingGrams) : null;
  if (!perServing && !perGram) return labelFlow(p.code, p.name);
  let mode = perServing ? "serving" : "grams";

  openSheet(head(esc(p.name), `${p.brand ? esc(p.brand) + " · " : ""}${p.source === "off" ? "Open Food Facts" : "From your label photo"} · ${esc(p.code)}`) + `
    <p class="note">${perServing ? `Per serving${p.servingLabel ? ` (${esc(p.servingLabel)})` : ""}: <b>${r0(perServing.kcal)} kcal</b>` : ""}${perServing && p.per100 ? "<br>" : ""}${p.per100 ? `Per 100 g: ${r0(p.per100.kcal)} kcal` : ""}</p>
    ${perServing && perGram ? `<div class="seg" id="seg"><button data-m="serving">Servings</button><button data-m="grams">Grams</button></div>` : ""}
    <label class="f" id="amtLbl"></label>
    <div class="stepper"><button id="minus" aria-label="Less">−</button><input type="text" inputmode="decimal" id="amt"><button id="plus" aria-label="More">+</button></div>
    <div class="total"><span>Total</span><span id="tot"></span></div>
    <p class="note" id="mac"></p>
    <button class="btn" id="add">Add to log</button>
    <button class="btn ghost" id="relabel">Values look wrong? Re-read the label</button>
    <button class="btn danger" id="forget">Remove from saved products</button>`);

  const amt = $("#amt");
  const setMode = (m) => {
    mode = m;
    amt.value = m === "serving" ? "1" : String(p.servingGrams ? r0(p.servingGrams) : 100);
    $("#amtLbl").textContent = m === "serving" ? "Servings" : "Grams eaten";
    sheet.querySelectorAll("#seg button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
    upd();
  };
  const total = () => scale(mode === "serving" ? perServing : perGram, num(amt.value));
  const upd = () => {
    const t = total();
    $("#tot").textContent = `${r0(t.kcal)} kcal`;
    $("#mac").textContent = `Protein ${r1(t.protein)} g · Carbs ${r1(t.carbs)} g · Fat ${r1(t.fat)} g`;
    $("#add").disabled = num(amt.value) <= 0;
  };
  const step = (d) => { const inc = mode === "serving" ? 0.5 : 10; amt.value = String(Math.max(0, r1(num(amt.value) + d * inc))); upd(); };
  amt.oninput = upd;
  $("#minus").onclick = () => step(-1);
  $("#plus").onclick = () => step(1);
  const seg = $("#seg"); if (seg) seg.onclick = (e) => { const b = e.target.closest("button"); if (b) setMode(b.dataset.m); };
  setMode(mode);
  $("#add").onclick = () => {
    p.used = Date.now(); products[p.code] = p; saveProducts();
    const a = num(amt.value);
    addEntries([{ name: p.name, detail: mode === "serving" ? `${a} × ${p.servingLabel || "serving"}` : `${a} g`, source: p.source === "off" ? "barcode" : "label", ...total() }]);
  };
  $("#relabel").onclick = () => labelFlow(p.code, p.name);
  $("#forget").onclick = () => { delete products[p.code]; saveProducts(); render(); closeSheet(); };
}

/* ---------------- Nutrition label (new product) ---------------- */
function labelFlow(code, name) {
  const hasKey = !!apiKey();
  openSheet(head("New product", `Barcode ${esc(code)} isn't in the database${name ? " with nutrition data" : ""}. Photograph its Nutrition Facts label once and it's saved for next time.`) + `
    ${hasKey ? `<label class="btn filebtn">📷 Photograph nutrition label<input type="file" accept="image/*" capture="environment" id="lblFile"></label>` : `<p class="note">Add a Claude API key in Settings to fill this in from a photo. You can type the values for now.</p>`}
    <img class="preview" id="lblPrev" hidden alt="">
    <div class="status" id="lblStatus"></div>
    <p class="note" style="margin-top:12px">Check every value against the package before saving.</p>
    <label class="f">Product name</label><input type="text" id="fName" value="${esc(name)}">
    <div class="row" style="gap:8px">
      <div style="flex:2"><label class="f">Serving size</label><input type="text" id="fServ" placeholder="e.g. 1 bar (40g)"></div>
      <div style="flex:1"><label class="f">Serving (g)</label><input type="text" inputmode="decimal" id="fGrams"></div>
    </div>
    <div class="grid4">
      <div><label class="f">kcal</label><input type="text" inputmode="decimal" id="fK"></div>
      <div><label class="f">Protein g</label><input type="text" inputmode="decimal" id="fP"></div>
      <div><label class="f">Carbs g</label><input type="text" inputmode="decimal" id="fC"></div>
      <div><label class="f">Fat g</label><input type="text" inputmode="decimal" id="fF"></div>
    </div>
    <button class="btn" id="fSave">Save product</button>`);

  const f = $("#lblFile");
  if (f) f.onchange = async () => {
    const file = f.files[0]; if (!file) return;
    const st = $("#lblStatus"); st.className = "status"; st.innerHTML = spinner("Reading the label…");
    try {
      const img = await prepImage(file, 1600, 0.85);
      $("#lblPrev").src = img.preview; $("#lblPrev").hidden = false;
      const r = await claudeJSON(`This is a photo of a packaged food's Nutrition Facts / nutrition information panel.
Extract the values EXACTLY as printed for ONE SERVING. If only per-100g values are printed, use those and set servingLabel to "100 g" and servingGrams to 100.
Return JSON: {"readable":boolean,"name":string (product name if visible, else ""),"servingLabel":string,"servingGrams":number|null,"kcal":number,"protein":number,"carbs":number,"fat":number}
If the panel is not legible, set readable to false. Never guess numbers you cannot read.`, img.base64);
      if (r.readable === false) { st.className = "status err"; st.textContent = "The label wasn't readable. Retake it flat, close and in good light, or type the values."; return; }
      if (!$("#fName").value && r.name) $("#fName").value = r.name;
      $("#fServ").value = r.servingLabel || "";
      $("#fGrams").value = r.servingGrams ? r.servingGrams : "";
      $("#fK").value = num(r.kcal); $("#fP").value = num(r.protein); $("#fC").value = num(r.carbs); $("#fF").value = num(r.fat);
      st.textContent = "Filled in from the label. Double-check, then save.";
    } catch (e) { st.className = "status err"; st.textContent = e.message; }
    f.value = "";
  };
  $("#fSave").onclick = () => {
    if (!num($("#fK").value)) { $("#fK").focus(); return; }
    const g = num($("#fGrams").value);
    const p = {
      code, name: $("#fName").value.trim() || `Product ${code}`, brand: "",
      servingLabel: $("#fServ").value.trim(), servingGrams: g > 0 ? g : undefined,
      perServing: { kcal: num($("#fK").value), protein: num($("#fP").value), carbs: num($("#fC").value), fat: num($("#fF").value) },
      source: "label", used: Date.now(),
    };
    products[code] = p; saveProducts(); render(); showProduct(p);
  };
}

/* ---------------- Meal photo ---------------- */
$("#actMeal").onclick = () => {
  if (!apiKey()) {
    openSheet(head("Snap meal") + `<p class="note">Meal photos are analyzed by Claude. Add your API key in Settings first.</p><button class="btn" id="goSet">Open Settings</button>`);
    $("#goSet").onclick = openSettings; return;
  }
  let img = null, rows = [];
  openSheet(head("Snap meal", "Shoot from directly above with the whole plate in frame. A fork or your hand in shot helps judge size.") + `
    <label class="btn filebtn" id="phPick"><span id="phPickTxt">📷 Take or choose photo</span><input type="file" accept="image/*" capture="environment" id="phFile"></label>
    <img class="preview" id="phPrev" hidden alt="">
    <label class="f">Anything the photo can't show? (optional, the biggest accuracy boost)</label>
    <textarea id="phHint" placeholder="e.g. cooked in 1 tbsp olive oil, about 1 cup rice, chicken thigh with skin"></textarea>
    <button class="btn" id="phGo" disabled>Analyze</button>
    <div class="status" id="phStatus"></div>
    <div id="phOut"></div>`);

  $("#phFile").onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      img = await prepImage(file, 1280, 0.8);
      $("#phPrev").src = img.preview; $("#phPrev").hidden = false;
      $("#phPickTxt").textContent = "📷 Retake photo"; $("#phGo").disabled = false; $("#phOut").innerHTML = "";
    } catch (err) { $("#phStatus").className = "status err"; $("#phStatus").textContent = err.message; }
    e.target.value = "";
  };

  $("#phGo").onclick = async () => {
    const st = $("#phStatus"); st.className = "status"; st.innerHTML = spinner("Identifying foods and estimating portions…");
    $("#phGo").disabled = true; $("#phOut").innerHTML = "";
    const hint = $("#phHint").value.trim().replace(/"/g, "'");
    try {
      const r = await claudeJSON(`You are a registered-dietitian-level nutrition estimator. Analyze this meal photo.
For each distinct food or drink: identify it, estimate the portion weight in grams using visual cues (a dinner plate is ~26 cm; also use utensils, hands, packaging), and account for visible oils, butter, sauces, dressings and cooking method.
${hint ? `The user adds this context; treat it as reliable and prefer it over visual guesses: "${hint}"` : ""}
Use standard USDA-style nutrition values for the estimated portion.
Return JSON exactly in this shape:
{"items":[{"name":string,"grams":number,"portion":string (human-friendly, e.g. "about 1 cup"),"kcal":number,"protein":number,"carbs":number,"fat":number}],
 "confidence":"high"|"medium"|"low",
 "tips":string (one short sentence on what would most improve this estimate)}
If there is no food in the image, return {"items":[],"confidence":"low","tips":"No food detected."}`, img.base64);
      st.textContent = "";
      rows = (Array.isArray(r.items) ? r.items : []).map((it) => {
        const m = { kcal: num(it.kcal), protein: num(it.protein), carbs: num(it.carbs), fat: num(it.fat) };
        const g = num(it.grams);
        return { name: String(it.name || "Food"), portion: String(it.portion || ""), grams: g > 0 ? String(r0(g)) : "", on: true,
          perGram: g > 0 ? scale(m, 1 / g) : null, fixed: m };
      });
      drawRows(r);
    } catch (e) { st.className = "status err"; st.textContent = e.message; }
    $("#phGo").disabled = false; $("#phGo").textContent = "Re-analyze";
  };

  const rowMacros = (row) => (row.perGram && row.grams !== "" ? scale(row.perGram, num(row.grams)) : row.fixed);

  function drawRows(r) {
    const out = $("#phOut");
    if (!rows.length) { out.innerHTML = `<p class="status err">${esc(r.tips || "No food detected.")}</p>`; return; }
    out.innerHTML = `<p class="note" style="margin-top:14px">Confidence: <b>${esc(r.confidence || "medium")}</b>. ${esc(r.tips || "")} Change the grams on any item and its calories update.</p>` +
      rows.map((row, i) => `
        <div class="item" data-i="${i}">
          <div class="ih"><input type="text" data-k="name" value="${esc(row.name)}" aria-label="Food name"><input class="switch" type="checkbox" data-k="on" checked aria-label="Include"></div>
          ${row.portion ? `<div class="note">${esc(row.portion)}</div>` : ""}
          <div class="ib">
            <div class="g"><label class="f">Grams</label><input type="text" inputmode="decimal" data-k="grams" value="${esc(row.grams)}" ${row.perGram ? "" : "disabled"}></div>
            <div class="k"><b data-out="kcal"></b><div class="note" data-out="mac"></div></div>
          </div>
        </div>`).join("") +
      `<div class="total"><span>Total</span><span id="phTot"></span></div><button class="btn" id="phAdd">Add to log</button>`;
    rows.forEach((_, i) => refreshRow(i));
    $("#phAdd").onclick = () => addEntries(rows.filter((x) => x.on).map((x) => ({ name: x.name, detail: x.grams ? `≈${x.grams} g` : x.portion, source: "photo", ...rowMacros(x) })));
    out.oninput = out.onchange = (e) => {
      const box = e.target.closest(".item"); if (!box) return;
      const i = +box.dataset.i, k = e.target.dataset.k;
      if (k === "on") { rows[i].on = e.target.checked; box.classList.toggle("off", !e.target.checked); }
      else if (k) rows[i][k] = e.target.value;
      refreshRow(i);
    };
  }
  function refreshRow(i) {
    const box = sheet.querySelector(`.item[data-i="${i}"]`); if (!box) return;
    const m = rowMacros(rows[i]);
    box.querySelector('[data-out="kcal"]').textContent = `${r0(m.kcal)} kcal`;
    box.querySelector('[data-out="mac"]').textContent = `P ${r1(m.protein)} · C ${r1(m.carbs)} · F ${r1(m.fat)}`;
    const tot = rows.filter((x) => x.on).reduce((s, x) => s + rowMacros(x).kcal, 0);
    $("#phTot").textContent = `${r0(tot)} kcal`;
    $("#phAdd").disabled = !rows.some((x) => x.on);
  }
};

/* ---------------- Manual ---------------- */
$("#actManual").onclick = () => {
  openSheet(head("Add manually") + `
    <label class="f">Food</label><input type="text" id="mName" placeholder="e.g. Banana">
    <div class="grid4">
      <div><label class="f">kcal</label><input type="text" inputmode="decimal" id="mK"></div>
      <div><label class="f">Protein g</label><input type="text" inputmode="decimal" id="mP"></div>
      <div><label class="f">Carbs g</label><input type="text" inputmode="decimal" id="mC"></div>
      <div><label class="f">Fat g</label><input type="text" inputmode="decimal" id="mF"></div>
    </div>
    <button class="btn" id="mAdd">Add to log</button>`);
  $("#mAdd").onclick = () => {
    const name = $("#mName").value.trim(), k = num($("#mK").value);
    if (!name) return $("#mName").focus();
    if (!k) return $("#mK").focus();
    addEntries([{ name, source: "manual", kcal: k, protein: num($("#mP").value), carbs: num($("#mC").value), fat: num($("#mF").value) }]);
  };
};

/* ---------------- Settings ---------------- */
function openSettings() {
  openSheet(head("Settings") + `
    <h3 style="margin:8px 0 0;font-size:16px">Daily goals</h3>
    <label class="f">Calories (kcal)</label><input type="text" inputmode="numeric" id="gK" value="${goals.kcal}">
    <div class="grid3">
      <div><label class="f">Protein g</label><input type="text" inputmode="numeric" id="gP" value="${goals.protein}"></div>
      <div><label class="f">Carbs g</label><input type="text" inputmode="numeric" id="gC" value="${goals.carbs}"></div>
      <div><label class="f">Fat g</label><input type="text" inputmode="numeric" id="gF" value="${goals.fat}"></div>
    </div>
    <p class="note" id="gNote"></p>

    <h3 style="margin:18px 0 0;font-size:16px">Claude API key</h3>
    <p class="note">Used for meal photos and label reading. Saved only in this browser on this phone, and sent only to Anthropic. Each photo costs roughly a cent or two.</p>
    <label class="f">API key</label><input type="password" id="sKey" value="${esc(apiKey())}" placeholder="sk-ant-…" autocomplete="off" autocapitalize="off" spellcheck="false">
    <p class="note"><a class="link" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Get a key at console.anthropic.com →</a></p>
    <label class="f">Model</label><input type="text" id="sModel" value="${esc(model())}" autocapitalize="off" spellcheck="false">
    <p class="note">Default ${DEFAULT_MODEL}. Use claude-opus-5-5 for the most careful estimates.</p>
    <button class="btn" id="sSave">Save</button>

    <h3 style="margin:22px 0 0;font-size:16px">Backup</h3>
    <p class="note">Your log lives in this browser. Export a backup now and then. Import restores it on any device.</p>
    <div class="row"><button class="btn ghost" id="exp">Export backup</button><label class="btn ghost filebtn">Import backup<input type="file" accept="application/json,.json" id="imp"></label></div>
    <p class="note" style="margin-top:16px;text-align:center">Barcode data from <a class="link" href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a>, a free community database.</p>`);

  const note = () => { $("#gNote").textContent = `Your macros add up to ${r0(num($("#gP").value) * 4 + num($("#gC").value) * 4 + num($("#gF").value) * 9)} kcal.`; };
  ["gP", "gC", "gF"].forEach((id) => ($("#" + id).oninput = note)); note();
  $("#sSave").onclick = () => {
    goals = { kcal: num($("#gK").value) || 2000, protein: num($("#gP").value), carbs: num($("#gC").value), fat: num($("#gF").value) };
    store.set("goals", goals);
    const k = $("#sKey").value.trim(); k ? store.set("apiKey", k) : store.del("apiKey");
    store.set("model", $("#sModel").value.trim() || DEFAULT_MODEL);
    render(); closeSheet();
  };
  $("#exp").onclick = () => {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(PREFIX) && k !== PREFIX + "apiKey") data[k] = localStorage.getItem(k);
    }
    const blob = new Blob([JSON.stringify({ app: "calorie-tracker", version: 1, exported: new Date().toISOString(), data }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `calorie-tracker-backup-${dayKey(new Date())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  $("#imp").onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      if (j.app !== "calorie-tracker" || !j.data) throw new Error();
      if (!confirm("Import this backup? Days in the backup will replace the same days here.")) return;
      for (const [k, v] of Object.entries(j.data)) if (k.startsWith(PREFIX) && k !== PREFIX + "apiKey") localStorage.setItem(k, v);
      goals = { ...DEFAULT_GOALS, ...store.get("goals", {}) }; products = store.get("products", {});
      loadDay(); closeSheet();
    } catch { alert("That file isn't a Calorie Tracker backup."); }
  };
}
$("#openSettings").onclick = openSettings;

/* ---------------- Boot ---------------- */
const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
if (!standalone && !store.get("installTipSeen", false) && /iPhone|iPad|Android/i.test(navigator.userAgent)) $("#installBanner").hidden = false;
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") closeScanner(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
loadDay();
})();
