// ============================================================
// MoneyIn — UI helpers
// ============================================================

export function formatMoney(amount) {
  const n = Number(amount) || 0;
  const sign = n < 0 ? "-" : "";
  return `${sign}€${Math.abs(n).toFixed(2)}`;
}

export function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + (dateStr.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function el(tag, className, content) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (content !== undefined) e.innerHTML = content;
  return e;
}

// ---- Toast ----
let toastTimer = null;
export function showToast(message, isError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.toggle("is-error", isError);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
}

// ---- Bottom sheets ----
const backdrop = document.getElementById("sheet-backdrop");
let openSheetEl = null;

export function openSheet(id) {
  closeSheet(); // only one at a time
  const sheet = document.getElementById(id);
  if (!sheet) return;
  backdrop.hidden = false;
  sheet.hidden = false;
  openSheetEl = sheet;
  document.body.style.overflow = "hidden";
}

export function closeSheet() {
  if (openSheetEl) openSheetEl.hidden = true;
  backdrop.hidden = true;
  openSheetEl = null;
  document.body.style.overflow = "";
}

backdrop.addEventListener("click", closeSheet);
document.querySelectorAll("[data-close]").forEach(btn => {
  btn.addEventListener("click", closeSheet);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSheet();
});

// ---- Confirm dialog ----
export function confirmDialog(message) {
  return new Promise((resolve) => {
    const dialog = document.getElementById("confirm-dialog");
    const msgEl = document.getElementById("confirm-message");
    const okBtn = document.getElementById("confirm-ok");
    const cancelBtn = document.getElementById("confirm-cancel");

    msgEl.textContent = message;
    dialog.hidden = false;

    const cleanup = (result) => {
      dialog.hidden = true;
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}

// ---- Ledger row builder (signature pattern) ----
/**
 * Builds a ledger-style row: avatar/icon, title, dotted leader, amount.
 * @param {Object} opts - {avatarText, title, sub, amount, amountTone, onClick}
 */
export function buildLedgerRow({ avatarText, title, sub, amount, amountTone = "neutral", onClick }) {
  const row = document.createElement(onClick ? "button" : "div");
  row.className = "ledger-row";
  if (onClick) row.addEventListener("click", onClick);

  const avatar = el("span", "ledger-avatar", avatarText || "");

  const main = el("div", "ledger-main");
  const titleEl = el("div", "ledger-title", title);
  main.appendChild(titleEl);
  if (sub) main.appendChild(el("div", "ledger-sub", sub));

  row.appendChild(avatar);
  row.appendChild(main);

  if (amount !== undefined) {
    row.appendChild(el("span", "ledger-leader"));
    const amountEl = el("span", `ledger-amount ledger-amount--${amountTone}`, amount);
    row.appendChild(amountEl);
  }

  return row;
}

// ---- Chip group helper ----
export function wireChipGroup(containerEl, hiddenInputEl) {
  containerEl.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    containerEl.querySelectorAll(".chip").forEach(c => c.classList.remove("is-active"));
    chip.classList.add("is-active");
    if (hiddenInputEl) hiddenInputEl.value = chip.dataset.value;
  });
}

export function setActiveChip(containerEl, value) {
  containerEl.querySelectorAll(".chip").forEach(c => {
    c.classList.toggle("is-active", c.dataset.value === value);
  });
}
