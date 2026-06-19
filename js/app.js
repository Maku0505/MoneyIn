// ============================================================
// MoneyIn — App orchestration
// ============================================================

import { auth } from "./firebase-config.js";
import * as Auth from "./auth.js";
import * as Data from "./data.js";
import * as Settle from "./settlement.js";
import {
  formatMoney, initials, formatDate, todayISO, el,
  showToast, openSheet, closeSheet, confirmDialog,
  buildLedgerRow, wireChipGroup, setActiveChip
} from "./ui.js";

// ----------------------------------------------------------------
// Global state
// ----------------------------------------------------------------
const state = {
  user: null,           // Firebase auth user
  profile: null,         // Firestore user doc
  groups: [],             // all groups the user belongs to
  contacts: [],            // resolved friend profiles
  friendRequests: [],       // incoming friend requests
  groupInvites: [],          // incoming group invites
  notifications: [],          // in-app notifications
  currentGroupId: null,        // open group detail
  currentGroupExpenses: [],     // expenses for open group
  currentContactId: null,        // open contact detail
  pendingGroupInvites: [],        // staged invites in "create group" sheet
  groupBalances: {},              // groupId → { myBalance, expenseCount }
  unsubscribers: []
};

let groupExpensesUnsub = null;

// ----------------------------------------------------------------
// Auth screen wiring
// ----------------------------------------------------------------

const authScreen = document.getElementById("auth-screen");
const appShell = document.getElementById("app-shell");
const authError = document.getElementById("auth-error");

document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    const isSignin = tab.dataset.tab === "signin";
    document.getElementById("signin-form").hidden = !isSignin;
    document.getElementById("signup-form").hidden = isSignin;
    hideAuthError();
  });
});

function showAuthError(message) {
  authError.textContent = message;
  authError.hidden = false;
}
function hideAuthError() { authError.hidden = true; }

document.getElementById("signin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAuthError();
  const fd = new FormData(e.target);
  try {
    await Auth.signIn(fd.get("email"), fd.get("password"));
  } catch (err) {
    showAuthError(friendlyAuthError(err));
  }
});

document.getElementById("signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAuthError();
  const fd = new FormData(e.target);
  try {
    await Auth.signUp(fd.get("email"), fd.get("password"), fd.get("displayName"));
  } catch (err) {
    showAuthError(friendlyAuthError(err));
  }
});

document.getElementById("google-signin-btn").addEventListener("click", async () => {
  hideAuthError();
  try {
    await Auth.signInWithGoogle();
  } catch (err) {
    showAuthError(err.message || friendlyAuthError(err));
  }
});

document.getElementById("forgot-password-btn").addEventListener("click", async () => {
  hideAuthError();
  const email = document.querySelector('#signin-form input[name="email"]').value;
  try {
    await Auth.resetPassword(email);
    showToast("Password reset email sent.");
  } catch (err) {
    showAuthError(err.message || friendlyAuthError(err));
  }
});

function friendlyAuthError(err) {
  const code = err?.code || "";
  if (code.includes("user-not-found") || code.includes("wrong-password") || code.includes("invalid-credential")) {
    return "Incorrect email or password.";
  }
  if (code.includes("email-already-in-use")) return "An account with this email already exists.";
  if (code.includes("weak-password")) return "Password should be at least 6 characters.";
  if (code.includes("invalid-email")) return "Enter a valid email address.";
  return err.message || "Something went wrong. Try again.";
}

// ----------------------------------------------------------------
// Auth state → bootstrap / teardown
// ----------------------------------------------------------------

Auth.watchAuthState(async (user) => {
  teardownSubscriptions();

  if (!user) {
    state.user = null;
    state.profile = null;
    authScreen.hidden = false;
    appShell.hidden = true;
    return;
  }

  state.user = user;
  authScreen.hidden = true;
  appShell.hidden = false;

  bootstrapSubscriptions(user.uid);
});

function teardownSubscriptions() {
  state.unsubscribers.forEach(u => u());
  state.unsubscribers = [];
  if (groupExpensesUnsub) { groupExpensesUnsub(); groupExpensesUnsub = null; }
}

function bootstrapSubscriptions(uid) {
  state.unsubscribers.push(
    Data.watchUserProfile(uid, async (profile) => {
      state.profile = profile;
      if (profile) {
        document.getElementById("profile-initial").textContent = initials(profile.displayName);
        document.getElementById("profile-email").textContent = profile.email || "";
      }
      renderHome();

      // Resolve contacts whenever the profile's friends list changes
      if (!profile || !profile.friends || profile.friends.length === 0) {
        state.contacts = [];
        renderContactsList();
        return;
      }
      const map = await Data.getUsersByIds(profile.friends);
      state.contacts = Object.values(map);
      renderContactsList();
    })
  );

  state.unsubscribers.push(
    Data.watchUserGroups(uid, async (groups) => {
      state.groups = groups;
      renderGroupsList();
      renderHome();
      if (state.currentGroupId) {
        const g = groups.find(gr => gr.id === state.currentGroupId);
        if (g) renderGroupDetailHeader(g);
      }
      computeGroupBalances(groups, uid);
    })
  );

  state.unsubscribers.push(
    Data.watchIncomingFriendRequests(uid, (reqs) => {
      state.friendRequests = reqs;
      renderNotifBadge();
    })
  );

  state.unsubscribers.push(
    Data.watchIncomingGroupInvites(uid, (invites) => {
      state.groupInvites = invites;
      renderNotifBadge();
    })
  );

  state.unsubscribers.push(
    Data.watchNotifications(uid, (notifs) => {
      state.notifications = notifs;
      renderNotifBadge();
    })
  );
}

function renderNotifBadge() {
  const total = state.friendRequests.length + state.groupInvites.length +
    state.notifications.filter(n => !n.read).length;
  document.getElementById("notif-dot").hidden = total === 0;
}

// ----------------------------------------------------------------
// Navigation
// ----------------------------------------------------------------

function switchView(viewName) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("is-active"));
  const target = document.getElementById(`view-${viewName}`);
  if (target) target.classList.add("is-active");

  document.querySelectorAll(".topbar-tab, .bottom-nav-item").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.view === viewName);
  });

  window.scrollTo(0, 0);
}

document.querySelectorAll("[data-view]").forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});
document.querySelectorAll("[data-view-link]").forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.viewLink));
});

// ----------------------------------------------------------------
// HOME
// ----------------------------------------------------------------

function renderHome() {
  if (!state.profile) return;

  // Compute totals across all groups using each group's already-loaded expenses
  // is too heavy here; instead we lazily compute by summing groupBalances we
  // maintain client-side per group when expenses change. For home, we do a
  // light aggregate by re-deriving from cached per-group balances if present.
  let totalOwed = 0, totalOwe = 0;

  const favIds = state.profile.starredGroups || [];
  const favGroups = state.groups.filter(g => favIds.includes(g.id));
  const favContainer = document.getElementById("home-favorite-groups");
  favContainer.innerHTML = "";
  if (favGroups.length === 0) {
    favContainer.innerHTML = `<p class="empty-hint">Star a group to pin it here.</p>`;
  } else {
    favGroups.forEach(g => {
      favContainer.appendChild(buildLedgerRow({
        avatarText: initials(g.name),
        title: g.name,
        sub: g.description || "Group",
        onClick: () => openGroupDetail(g.id)
      }));
    });
  }

  // Aggregate balances across all groups (fetched once per render)
  computeAllGroupBalancesForUser().then(({ owed, owe, recent }) => {
    document.getElementById("home-total-owed").textContent = formatMoney(owed);
    document.getElementById("home-total-owe").textContent = formatMoney(owe);

    const recentContainer = document.getElementById("home-recent-activity");
    recentContainer.innerHTML = "";
    if (recent.length === 0) {
      recentContainer.innerHTML = `<p class="empty-hint">No activity yet. Add an expense to get started.</p>`;
    } else {
      recent.slice(0, 6).forEach(item => {
        recentContainer.appendChild(buildLedgerRow({
          avatarText: "💸",
          title: item.description,
          sub: `${item.groupName} · ${formatDate(item.date)}`,
          amount: formatMoney(item.userImpact),
          amountTone: item.userImpact > 0 ? "positive" : item.userImpact < 0 ? "negative" : "neutral"
        }));
      });
    }
  });

  void totalOwed; void totalOwe;
}

/** Fetches expenses for every group once to aggregate the user's overall position. */
async function computeAllGroupBalancesForUser() {
  const uid = state.user.uid;
  let owed = 0, owe = 0;
  const recent = [];

  await Promise.all(state.groups.map(async (g) => {
    const expenses = await fetchGroupExpensesOnce(g.id);
    const balances = Settle.computeBalances(expenses, g.members || []);
    const mine = balances[uid] || 0;
    if (mine > 0) owed += mine; else owe += -mine;

    expenses.forEach(exp => {
      const paid = (exp.paidBy && exp.paidBy[uid]) || 0;
      const share = (exp.splitBetween && exp.splitBetween[uid]) || 0;
      recent.push({
        description: exp.description,
        date: exp.date,
        groupName: g.name,
        userImpact: Math.round((paid - share) * 100) / 100,
        myShare: Math.round(share * 100) / 100,
        createdAtMs: exp.createdAt?.toMillis ? exp.createdAt.toMillis() : 0
      });
    });
  }));

  recent.sort((a, b) => b.createdAtMs - a.createdAtMs);
  return { owed: Math.round(owed * 100) / 100, owe: Math.round(owe * 100) / 100, recent };
}

function fetchGroupExpensesOnce(groupId) {
  return new Promise((resolve) => {
    const unsub = Data.watchGroupExpenses(groupId, (expenses) => {
      unsub();
      resolve(expenses);
    });
  });
}

// ----------------------------------------------------------------
// GROUPS LIST
// ----------------------------------------------------------------

async function computeGroupBalances(groups, uid) {
  const results = {};
  await Promise.all(groups.map(async (g) => {
    const expenses = await fetchGroupExpensesOnce(g.id);
    const balances = Settle.computeBalances(expenses, g.members || []);
    const expenseCount = expenses.filter(e => e.type !== "Payment").length;
    results[g.id] = { myBalance: balances[uid] || 0, expenseCount };
  }));
  state.groupBalances = results;
  renderGroupsList();
}

function buildGroupRow(g) {
  const info = state.groupBalances[g.id];
  const myBalance = info?.myBalance ?? null;
  const expCount = info?.expenseCount ?? null;
  const memberCount = (g.members || []).length;
  const sub = expCount !== null
    ? `${memberCount} member${memberCount === 1 ? "" : "s"} · ${expCount} expense${expCount === 1 ? "" : "s"}`
    : `${memberCount} member${memberCount === 1 ? "" : "s"}`;

  const amount = (myBalance !== null && Math.abs(myBalance) >= 0.005)
    ? formatMoney(Math.abs(myBalance)) : undefined;
  const amountTone = myBalance !== null && myBalance > 0 ? "positive"
    : myBalance !== null && myBalance < 0 ? "negative" : "neutral";

  return buildLedgerRow({ avatarText: initials(g.name), title: g.name, sub, amount, amountTone, onClick: () => openGroupDetail(g.id) });
}

function renderGroupsList() {
  const container = document.getElementById("groups-list");
  container.innerHTML = "";
  if (state.groups.length === 0) {
    container.innerHTML = `<p class="empty-hint">No groups yet. Create one to start splitting expenses.</p>`;
    return;
  }

  const searchTerm = document.getElementById("groups-search").value.trim().toLowerCase();
  const filtered = state.groups.filter(g => g.name.toLowerCase().includes(searchTerm));

  if (filtered.length === 0) {
    container.innerHTML = `<p class="empty-hint">No groups match your search.</p>`;
    return;
  }

  const favIds = (state.profile?.starredGroups) || [];
  const favs = filtered.filter(g => favIds.includes(g.id));
  const owedGroups = filtered.filter(g => !favIds.includes(g.id) && (state.groupBalances[g.id]?.myBalance ?? 0) > 0.005);
  const oweGroups = filtered.filter(g => !favIds.includes(g.id) && (state.groupBalances[g.id]?.myBalance ?? 0) < -0.005);
  const settledGroups = filtered.filter(g => !favIds.includes(g.id) && Math.abs(state.groupBalances[g.id]?.myBalance ?? 0) <= 0.005);

  function addSection(label, groups) {
    if (groups.length === 0) return;
    const header = el("p", "section-subhead", label);
    header.style.marginTop = "var(--sp-4)";
    container.appendChild(header);
    groups.forEach(g => container.appendChild(buildGroupRow(g)));
  }

  addSection("Favourites", favs);
  addSection("You are owed", owedGroups);
  addSection("You owe", oweGroups);
  addSection("Settled up", settledGroups);
}

document.getElementById("groups-search").addEventListener("input", renderGroupsList);

document.getElementById("new-group-btn").addEventListener("click", () => {
  document.getElementById("group-form").reset();
  setActiveChip(document.getElementById("group-type-chips"), "general");
  document.querySelector('#group-form input[name="type"]').value = "general";
  state.pendingGroupInvites = [];
  renderPendingInvites();
  renderGroupInviteContacts();
  openSheet("sheet-group");
});

wireChipGroup(
  document.getElementById("group-type-chips"),
  document.querySelector('#group-form input[name="type"]')
);

function renderGroupInviteContacts() {
  const container = document.getElementById("group-invite-contacts");
  container.innerHTML = "";
  if (state.contacts.length === 0) {
    container.innerHTML = `<p class="empty-hint">No contacts yet — invite by email below.</p>`;
    return;
  }
  state.contacts.forEach(c => {
    const row = el("label", "checkbox-row");
    row.innerHTML = `
      <input type="checkbox" data-uid="${c.id}" data-name="${escapeHtml(c.displayName)}" data-email="${escapeHtml(c.email)}" />
      <span class="row-name">${escapeHtml(c.displayName)}</span>
    `;
    container.appendChild(row);
  });
}

document.getElementById("group-invite-email-btn").addEventListener("click", () => {
  const input = document.getElementById("group-invite-email");
  const email = input.value.trim();
  if (!email || !email.includes("@")) {
    showToast("Enter a valid email address.", true);
    return;
  }
  if (state.pendingGroupInvites.some(p => p.email === email)) {
    showToast("Already added.", true);
    return;
  }
  state.pendingGroupInvites.push({ email, byEmail: true });
  input.value = "";
  renderPendingInvites();
});

function renderPendingInvites() {
  const container = document.getElementById("group-invite-pending");
  container.innerHTML = "";
  state.pendingGroupInvites.forEach((p, idx) => {
    const chip = el("span", "pending-chip");
    chip.innerHTML = `${escapeHtml(p.email)} <button type="button">✕</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      state.pendingGroupInvites.splice(idx, 1);
      renderPendingInvites();
    });
    container.appendChild(chip);
  });
}

document.getElementById("group-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const name = fd.get("name").trim();
  if (!name) return;

  const checkedContacts = Array.from(
    document.querySelectorAll("#group-invite-contacts input:checked")
  ).map(input => ({
    uid: input.dataset.uid, name: input.dataset.name, email: input.dataset.email
  }));

  try {
    const groupId = await Data.createGroup({
      name, description: fd.get("description"), type: fd.get("type"),
      createdBy: state.user.uid
    });

    // Invite contacts directly
    for (const c of checkedContacts) {
      await Data.inviteToGroup(groupId, name, state.user.uid, state.profile.displayName, c.uid, c.name);
    }
    // Invite by email — resolve to a user if one exists
    for (const p of state.pendingGroupInvites) {
      const found = await Auth.findUserByEmail(p.email);
      if (found) {
        await Data.inviteToGroup(groupId, name, state.user.uid, state.profile.displayName, found.id, found.displayName);
      } else {
        showToast(`No MoneyIn account found for ${p.email} — they'll need to sign up first.`, true);
      }
    }

    closeSheet();
    showToast("Group created.");
    openGroupDetail(groupId);
  } catch (err) {
    showToast(err.message || "Couldn't create the group.", true);
  }
});

// ----------------------------------------------------------------
// GROUP DETAIL
// ----------------------------------------------------------------

function openGroupDetail(groupId) {
  state.currentGroupId = groupId;
  switchView("group-detail");

  if (groupExpensesUnsub) groupExpensesUnsub();
  groupExpensesUnsub = Data.watchGroupExpenses(groupId, (expenses) => {
    state.currentGroupExpenses = expenses;
    const g = state.groups.find(gr => gr.id === groupId);
    if (g) {
      renderGroupDetailHeader(g);
      renderGroupMembers(g, expenses);
      renderGroupExpenses(g, expenses);
      renderGroupSettlements(g, expenses);
    }
  });
}

function renderGroupDetailHeader(group) {
  document.getElementById("group-detail-name").textContent = group.name;
  const descEl = document.getElementById("group-detail-description");
  if (descEl) {
    descEl.textContent = group.description || "";
    descEl.hidden = !group.description;
  }
}

function renderGroupMembers(group, expenses) {
  const balances = Settle.computeBalances(expenses, group.members || []);
  const container = document.getElementById("group-members-list");
  container.innerHTML = "";

  // Member count badge in tab
  const countEl = document.getElementById("group-member-count");
  if (countEl) countEl.textContent = (group.members || []).length;

  // Expense count per member
  const paidCounts = {};
  expenses.filter(e => e.type !== "Payment").forEach(exp => {
    Object.keys(exp.paidBy || {}).forEach(uid => {
      paidCounts[uid] = (paidCounts[uid] || 0) + 1;
    });
  });

  // Update the top balance card with the *current user's* position
  const myBalance = balances[state.user.uid] || 0;
  const labelEl = document.getElementById("group-detail-balance-label");
  const amountEl = document.getElementById("group-detail-balance-amount");
  if (Math.abs(myBalance) < 0.005) {
    labelEl.textContent = "Settled up";
    amountEl.className = "balance-amount";
    amountEl.textContent = formatMoney(0);
  } else if (myBalance > 0) {
    labelEl.textContent = "You are owed";
    amountEl.className = "balance-amount balance-amount--positive";
    amountEl.textContent = formatMoney(myBalance);
  } else {
    labelEl.textContent = "You owe";
    amountEl.className = "balance-amount balance-amount--negative";
    amountEl.textContent = formatMoney(-myBalance);
  }

  Promise.resolve(Data.getUsersByIds(group.members || [])).then(usersMap => {
    container.innerHTML = "";
    (group.members || []).forEach(uid => {
      const u = usersMap[uid];
      const name = uid === state.user.uid ? "You" : (u?.displayName || "Member");
      const bal = balances[uid] || 0;
      const paidCount = paidCounts[uid] || 0;
      const sub = `Paid ${paidCount} expense${paidCount !== 1 ? "s" : ""}`;

      container.appendChild(buildLedgerRow({
        avatarText: initials(u?.displayName || "?"),
        title: name,
        sub,
        amount: Math.abs(bal) < 0.005 ? "—" : formatMoney(Math.abs(bal)),
        amountTone: bal > 0.005 ? "positive" : bal < -0.005 ? "negative" : "neutral"
      }));
    });
  });
}

function renderGroupExpenses(group, expenses) {
  const container = document.getElementById("group-expenses-list");
  container.innerHTML = "";
  if (expenses.length === 0) {
    container.innerHTML = `<p class="empty-hint">No expenses yet.</p>`;
    return;
  }
  expenses.forEach(exp => {
    const myPaid = (exp.paidBy && exp.paidBy[state.user.uid]) || 0;
    const myShare = (exp.splitBetween && exp.splitBetween[state.user.uid]) || 0;
    const impact = Math.round((myPaid - myShare) * 100) / 100;
    container.appendChild(buildLedgerRow({
      avatarText: exp.type === "Payment" ? "↔" : "🧾",
      title: exp.description,
      sub: formatDate(exp.date),
      amount: formatMoney(exp.totalAmount),
      amountTone: "neutral"
    }));
    void impact;
  });
}

function renderGroupSettlements(group, expenses) {
  const balances = Settle.computeBalances(expenses, group.members || []);
  const payments = Settle.suggestSettlements(balances);
  const container = document.getElementById("group-suggested-list");
  container.innerHTML = "";

  if (payments.length === 0) {
    container.innerHTML = `<p class="empty-hint">Everyone is settled up.</p>`;
    return;
  }

  Data.getUsersByIds(group.members || []).then(usersMap => {
    container.innerHTML = "";
    payments.forEach(p => {
      const fromName = p.from === state.user.uid ? "You" : (usersMap[p.from]?.displayName || "Member");
      const toName = p.to === state.user.uid ? "You" : (usersMap[p.to]?.displayName || "Member");
      container.appendChild(buildLedgerRow({
        avatarText: "→",
        title: `${fromName} pays ${toName}`,
        amount: formatMoney(p.amount),
        amountTone: "neutral"
      }));
    });
  });
}

document.getElementById("group-add-expense-btn").addEventListener("click", openAddExpenseSheet);

document.getElementById("group-settle-btn").addEventListener("click", openSettleSheet);

document.getElementById("group-settings-btn").addEventListener("click", () => {
  const group = state.groups.find(g => g.id === state.currentGroupId);
  if (!group) return;
  const form = document.getElementById("group-settings-form");
  form.name.value = group.name;
  form.description.value = group.description || "";
  form.type.value = group.type || "general";
  setActiveChip(document.getElementById("group-settings-type-chips"), group.type || "general");
  openSheet("sheet-group-settings");
});

wireChipGroup(
  document.getElementById("group-settings-type-chips"),
  document.querySelector('#group-settings-form input[name="type"]')
);

document.getElementById("group-settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await Data.updateGroup(state.currentGroupId, {
      name: fd.get("name").trim(),
      description: fd.get("description"),
      type: fd.get("type")
    });
    closeSheet();
    showToast("Group updated.");
  } catch (err) {
    showToast(err.message || "Couldn't update the group.", true);
  }
});

document.getElementById("leave-group-btn").addEventListener("click", async () => {
  const group = state.groups.find(g => g.id === state.currentGroupId);
  if (!group) return;
  const balances = Settle.computeBalances(state.currentGroupExpenses, group.members || []);
  const myBalance = balances[state.user.uid] || 0;
  if (Math.abs(myBalance) > 0.005) {
    showToast("Settle your balance before leaving this group.", true);
    return;
  }
  const confirmed = await confirmDialog(`Leave "${group.name}"? You'll need a new invite to rejoin.`);
  if (!confirmed) return;
  try {
    await Data.leaveGroup(group.id, state.user.uid);
    closeSheet();
    switchView("groups");
    showToast("You left the group.");
  } catch (err) {
    showToast(err.message || "Couldn't leave the group.", true);
  }
});

// ----------------------------------------------------------------
// ADD EXPENSE
// ----------------------------------------------------------------

function openAddExpenseSheet() {
  const group = state.groups.find(g => g.id === state.currentGroupId);
  if (!group) return;

  document.getElementById("expense-form").reset();
  document.getElementById("expense-form-error").hidden = true;
  document.querySelector('#expense-form input[name="date"]').value = todayISO();
  const counter = document.getElementById("expense-desc-counter");
  if (counter) counter.textContent = "0";
  setActiveChip(document.getElementById("expense-category-chips"), "general");
  document.querySelector('#expense-form input[name="category"]').value = "general";

  // Reset split mode to Total
  document.querySelectorAll(".split-tab").forEach(t => t.classList.toggle("is-active", t.dataset.split === "total"));
  document.getElementById("split-total-panel").classList.add("is-active");
  document.getElementById("split-detail-panel").classList.remove("is-active");

  Data.getUsersByIds(group.members || []).then(usersMap => {
    // Paid-by select
    const paidBySelect = document.getElementById("expense-paid-by");
    paidBySelect.innerHTML = "";
    (group.members || []).forEach(uid => {
      const opt = el("option");
      opt.value = uid;
      opt.textContent = uid === state.user.uid ? "You" : (usersMap[uid]?.displayName || "Member");
      if (uid === state.user.uid) opt.selected = true;
      paidBySelect.appendChild(opt);
    });

    // Split-with checkboxes
    const splitContainer = document.getElementById("expense-split-with");
    splitContainer.innerHTML = "";
    (group.members || []).forEach(uid => {
      const row = el("label", "checkbox-row");
      const name = uid === state.user.uid ? "You" : (usersMap[uid]?.displayName || "Member");
      row.innerHTML = `<input type="checkbox" checked data-uid="${uid}" /><span class="row-name">${escapeHtml(name)}</span>`;
      splitContainer.appendChild(row);
    });

    // Detail rows
    const detailContainer = document.getElementById("expense-detail-rows");
    detailContainer.innerHTML = "";
    (group.members || []).forEach(uid => {
      const name = uid === state.user.uid ? "You" : (usersMap[uid]?.displayName || "Member");
      const row = el("div", "detail-row");
      row.innerHTML = `
        <span class="detail-row-name">${escapeHtml(name)}</span>
        <input type="number" step="0.01" min="0" placeholder="Paid" data-uid="${uid}" data-field="paid" value="0" />
        <input type="number" step="0.01" min="0" placeholder="Share" data-uid="${uid}" data-field="share" value="0" />
      `;
      detailContainer.appendChild(row);
    });
    wireDetailTotals();
  });

  openSheet("sheet-expense");
}

document.querySelectorAll(".split-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".split-tab").forEach(t => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    const mode = tab.dataset.split;
    document.getElementById("split-total-panel").classList.toggle("is-active", mode === "total");
    document.getElementById("split-detail-panel").classList.toggle("is-active", mode === "detail");
  });
});

wireChipGroup(
  document.getElementById("expense-category-chips"),
  document.querySelector('#expense-form input[name="category"]')
);

function wireDetailTotals() {
  const inputs = document.querySelectorAll("#expense-detail-rows input");
  const recompute = () => {
    let paidTotal = 0, shareTotal = 0;
    inputs.forEach(i => {
      const v = parseFloat(i.value) || 0;
      if (i.dataset.field === "paid") paidTotal += v; else shareTotal += v;
    });
    document.getElementById("detail-paid-total").textContent = paidTotal.toFixed(2);
    document.getElementById("detail-share-total").textContent = shareTotal.toFixed(2);
  };
  inputs.forEach(i => i.addEventListener("input", recompute));
  recompute();
}

document.getElementById("expense-description").addEventListener("input", () => {
  const counter = document.getElementById("expense-desc-counter");
  if (counter) counter.textContent = document.getElementById("expense-description").value.length;
});

document.getElementById("expense-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("expense-form-error");
  errorEl.hidden = true;

  const fd = new FormData(e.target);
  const description = fd.get("description").trim();
  const category = fd.get("category");
  const date = fd.get("date");
  const isDetailMode = document.getElementById("split-detail-panel").classList.contains("is-active");

  if (!description) {
    errorEl.textContent = "Add a short description.";
    errorEl.hidden = false;
    return;
  }

  let paidBy = {}, splitBetween = {}, totalAmount = 0;

  if (!isDetailMode) {
    totalAmount = parseFloat(document.getElementById("expense-total-amount").value);
    if (!totalAmount || totalAmount <= 0) {
      errorEl.textContent = "Enter a valid amount greater than zero.";
      errorEl.hidden = false;
      return;
    }
    const payer = document.getElementById("expense-paid-by").value;
    const checked = Array.from(document.querySelectorAll("#expense-split-with input:checked")).map(i => i.dataset.uid);
    if (checked.length === 0) {
      errorEl.textContent = "Select at least one person to split with.";
      errorEl.hidden = false;
      return;
    }
    const share = Math.round((totalAmount / checked.length) * 100) / 100;
    // Distribute remainder cents to keep sum exact
    let remainder = Math.round((totalAmount - share * checked.length) * 100);
    checked.forEach((uid, idx) => {
      let s = share;
      if (idx < Math.abs(remainder)) s += remainder > 0 ? 0.01 : -0.01;
      splitBetween[uid] = Math.round(s * 100) / 100;
    });
    paidBy[payer] = totalAmount;
  } else {
    const rows = document.querySelectorAll("#expense-detail-rows .detail-row");
    let paidTotal = 0, shareTotal = 0;
    rows.forEach(row => {
      const uid = row.querySelector('[data-field="paid"]').dataset.uid;
      const paid = parseFloat(row.querySelector('[data-field="paid"]').value) || 0;
      const share = parseFloat(row.querySelector('[data-field="share"]').value) || 0;
      if (paid > 0) paidBy[uid] = Math.round(paid * 100) / 100;
      if (share > 0) splitBetween[uid] = Math.round(share * 100) / 100;
      paidTotal += paid; shareTotal += share;
    });
    if (Math.abs(paidTotal - shareTotal) > 0.01) {
      errorEl.textContent = "Paid total must equal share total.";
      errorEl.hidden = false;
      return;
    }
    if (shareTotal <= 0) {
      errorEl.textContent = "At least one person needs a positive share.";
      errorEl.hidden = false;
      return;
    }
    totalAmount = Math.round(paidTotal * 100) / 100;
  }

  try {
    await Data.addExpense(state.currentGroupId, {
      description, type: category, totalAmount, date,
      createdBy: state.user.uid, paidBy, splitBetween
    });
    closeSheet();
    showToast("Expense added.");
  } catch (err) {
    errorEl.textContent = err.message || "Couldn't save the expense.";
    errorEl.hidden = false;
  }
});

// ----------------------------------------------------------------
// SETTLE UP
// ----------------------------------------------------------------

function openSettleSheet() {
  const group = state.groups.find(g => g.id === state.currentGroupId);
  if (!group) return;

  const subtitleEl = document.getElementById("settle-subtitle");
  if (subtitleEl) subtitleEl.textContent = `Choose how to settle balances in ${group.name}`;

  const balances = Settle.computeBalances(state.currentGroupExpenses, group.members || []);
  const payments = Settle.suggestSettlements(balances);
  const myPayments = payments.filter(p => p.from === state.user.uid || p.to === state.user.uid);

  const content = document.getElementById("settle-content");
  content.innerHTML = "";

  if (myPayments.length === 0) {
    content.innerHTML = `<p class="empty-hint">You're settled up in this group.</p>`;
    openSheet("sheet-settle");
    return;
  }

  Data.getUsersByIds(group.members || []).then(usersMap => {
    content.innerHTML = "";

    // Summary card
    const totalOwe = myPayments.filter(p => p.from === state.user.uid).reduce((s, p) => s + p.amount, 0);
    const totalOwed = myPayments.filter(p => p.to === state.user.uid).reduce((s, p) => s + p.amount, 0);

    if (totalOwe > 0 || totalOwed > 0) {
      content.appendChild(el("p", "settle-section-label", "Summary"));
      const summaryCard = el("div", "group-balance-card");
      summaryCard.style.marginBottom = "var(--sp-4)";
      if (totalOwe > 0) {
        summaryCard.innerHTML = `
          <span class="balance-label">You owe</span>
          <span class="balance-amount balance-amount--negative">${formatMoney(totalOwe)}</span>
        `;
      } else {
        summaryCard.innerHTML = `
          <span class="balance-label">You are owed</span>
          <span class="balance-amount balance-amount--positive">${formatMoney(totalOwed)}</span>
        `;
      }
      content.appendChild(summaryCard);
    }

    // Debts list
    content.appendChild(el("p", "settle-section-label", "Debts to settle"));
    const debtsList = el("div");
    myPayments.forEach(p => {
      const isOwing = p.from === state.user.uid;
      const otherUid = isOwing ? p.to : p.from;
      const otherName = usersMap[otherUid]?.displayName || "Member";

      const row = el("div", "settle-debt-row");
      row.innerHTML = `
        <span class="ledger-avatar">${initials(otherName)}</span>
        <div class="settle-debt-main">
          <div class="settle-debt-name">${escapeHtml(otherName)}</div>
          <div class="settle-debt-dir">${isOwing ? "You owe them" : "They owe you"}</div>
        </div>
        <span class="settle-debt-amount">${formatMoney(p.amount)}</span>
      `;
      debtsList.appendChild(row);
    });
    content.appendChild(debtsList);

    // Single action button
    const actionRow = el("div", "action-row");
    actionRow.style.marginTop = "var(--sp-5)";
    const markAllBtn = el("button", "btn btn-primary", "Mark all as settled");
    markAllBtn.addEventListener("click", async () => {
      try {
        for (const p of myPayments) {
          await Data.createSettlement(state.currentGroupId, {
            from: p.from, to: p.to, amount: p.amount, createdBy: state.user.uid
          });
        }
        closeSheet();
        showToast("Settlements recorded.");
      } catch (err) {
        showToast(err.message || "Couldn't record the settlement.", true);
      }
    });
    actionRow.appendChild(markAllBtn);
    content.appendChild(actionRow);

    const note = el("p", "hint-text", "MoneyIn doesn't move real money — this records debts as settled outside the app.");
    note.style.marginTop = "var(--sp-3)";
    content.appendChild(note);
  });

  openSheet("sheet-settle");
}

// ----------------------------------------------------------------
// CONTACTS
// ----------------------------------------------------------------

function renderContactsList() {
  const searchTerm = document.getElementById("contacts-search").value.trim().toLowerCase();
  const filtered = state.contacts.filter(c => (c.displayName || "").toLowerCase().includes(searchTerm));

  const favIds = (state.profile && state.profile.starredFriends) || [];
  const favs = filtered.filter(c => favIds.includes(c.id));
  const all = filtered;

  const favContainer = document.getElementById("contacts-favorites");
  favContainer.innerHTML = "";
  if (favs.length === 0) {
    favContainer.innerHTML = `<p class="empty-hint">No favorites yet.</p>`;
  } else {
    favs.forEach(c => favContainer.appendChild(buildContactRow(c, true)));
  }

  const allContainer = document.getElementById("contacts-all");
  allContainer.innerHTML = "";
  if (all.length === 0) {
    allContainer.innerHTML = `<p class="empty-hint">No contacts yet. Add someone by email.</p>`;
  } else {
    all.forEach(c => allContainer.appendChild(buildContactRow(c, favIds.includes(c.id))));
  }
}

function buildContactRow(contact, isFav) {
  const row = buildLedgerRow({
    avatarText: initials(contact.displayName),
    title: contact.displayName,
    sub: contact.email,
    onClick: () => openContactDetail(contact.id)
  });

  const starBtn = el("button", "icon-btn", isFav ? "★" : "☆");
  starBtn.style.color = isFav ? "var(--moss)" : "var(--grey-light)";
  starBtn.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    try {
      await Data.toggleStarredFriend(state.user.uid, contact.id, !isFav);
    } catch {
      showToast("Couldn't update favorite.", true);
    }
  });
  row.appendChild(starBtn);
  return row;
}

document.getElementById("contacts-search").addEventListener("input", renderContactsList);

document.getElementById("add-contact-btn").addEventListener("click", () => {
  document.getElementById("contact-form").reset();
  document.getElementById("contact-form-error").hidden = true;
  openSheet("sheet-contact");
});

document.getElementById("contact-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("contact-form-error");
  errorEl.hidden = true;
  const fd = new FormData(e.target);
  const email = fd.get("email").trim().toLowerCase();

  try {
    const found = await Auth.findUserByEmail(email);
    if (!found) {
      errorEl.textContent = "No MoneyIn account found with that email.";
      errorEl.hidden = false;
      return;
    }
    await Data.sendFriendRequest(found, state.user);
    closeSheet();
    showToast("Request sent.");
  } catch (err) {
    errorEl.textContent = err.message || "Couldn't send the request.";
    errorEl.hidden = false;
  }
});

function openContactDetail(contactUid) {
  state.currentContactId = contactUid;
  switchView("contact-detail");
  const contact = state.contacts.find(c => c.id === contactUid);
  document.getElementById("contact-detail-name").textContent = contact?.displayName || "Contact";

  const sharedGroups = state.groups.filter(g => (g.members || []).includes(contactUid));
  const container = document.getElementById("contact-shared-groups");
  container.innerHTML = "";

  if (sharedGroups.length === 0) {
    container.innerHTML = `<p class="empty-hint">No shared groups yet.</p>`;
    document.getElementById("contact-detail-balance-label").textContent = "Settled up";
    document.getElementById("contact-detail-balance-amount").textContent = formatMoney(0);
    document.getElementById("contact-detail-balance-amount").className = "balance-amount";
    return;
  }

  let netTotal = 0;

  Promise.all(sharedGroups.map(g => fetchGroupExpensesOnce(g.id).then(expenses => ({ g, expenses })))).then(results => {
    container.innerHTML = "";
    results.forEach(({ g, expenses }) => {
      const balances = Settle.computeBalances(expenses, g.members || []);
      // Approximate pairwise: in a 2-member group, the full group balance IS the pairwise balance.
      // In larger groups, we show the group balance as context rather than a false-precision pairwise number.
      const myBalance = balances[state.user.uid] || 0;
      if ((g.members || []).length === 2) netTotal += myBalance;

      container.appendChild(buildLedgerRow({
        avatarText: initials(g.name),
        title: g.name,
        sub: `${(g.members || []).length} members`,
        amount: Math.abs(myBalance) < 0.005 ? "Settled up" : formatMoney(Math.abs(myBalance)),
        amountTone: myBalance > 0.005 ? "positive" : myBalance < -0.005 ? "negative" : "neutral",
        onClick: () => openGroupDetail(g.id)
      }));
    });

    const labelEl = document.getElementById("contact-detail-balance-label");
    const amountEl = document.getElementById("contact-detail-balance-amount");
    if (Math.abs(netTotal) < 0.005) {
      labelEl.textContent = "Settled up (direct groups)";
      amountEl.className = "balance-amount";
      amountEl.textContent = formatMoney(0);
    } else if (netTotal > 0) {
      labelEl.textContent = `${contact?.displayName || "They"} owes you`;
      amountEl.className = "balance-amount balance-amount--positive";
      amountEl.textContent = formatMoney(netTotal);
    } else {
      labelEl.textContent = `You owe ${contact?.displayName || "them"}`;
      amountEl.className = "balance-amount balance-amount--negative";
      amountEl.textContent = formatMoney(-netTotal);
    }
  });
}

// ----------------------------------------------------------------
// ACTIVITY
// ----------------------------------------------------------------

async function renderActivity() {
  const { owed, owe, recent } = await computeAllGroupBalancesForUser();
  const now = new Date();
  const thisMonth = recent.filter(r => {
    const d = new Date(r.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const totalSpent = thisMonth.reduce((sum, r) => sum + (r.myShare || 0), 0);
  document.getElementById("activity-total-spent").textContent = formatMoney(totalSpent);

  const oweEl = document.getElementById("activity-total-owe");
  const owedByEl = document.getElementById("activity-total-owed-by");
  if (oweEl) oweEl.textContent = formatMoney(owe);
  if (owedByEl) owedByEl.textContent = formatMoney(owed);

  const feedContainer = document.getElementById("activity-feed");
  feedContainer.innerHTML = "";
  if (thisMonth.length === 0) {
    feedContainer.innerHTML = `<p class="empty-hint">No activity yet.</p>`;
  } else {
    // Group by date
    const byDate = new Map();
    thisMonth.forEach(item => {
      if (!byDate.has(item.date)) byDate.set(item.date, []);
      byDate.get(item.date).push(item);
    });
    byDate.forEach((items, date) => {
      feedContainer.appendChild(el("div", "feed-date-header", formatDate(date)));
      items.forEach(item => {
        feedContainer.appendChild(buildLedgerRow({
          avatarText: "🧾",
          title: item.description,
          sub: item.groupName,
          amount: formatMoney(item.userImpact),
          amountTone: item.userImpact > 0 ? "positive" : item.userImpact < 0 ? "negative" : "neutral"
        }));
      });
    });
  }

  // Category breakdown requires category data; refetch with category attached.
  const byCategory = {};
  await Promise.all(state.groups.map(async (g) => {
    const expenses = await fetchGroupExpensesOnce(g.id);
    expenses.forEach(exp => {
      const d = new Date(exp.date);
      if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return;
      const myShare = (exp.splitBetween && exp.splitBetween[state.user.uid]) || 0;
      if (myShare <= 0) return;
      const cat = exp.type === "Payment" ? null : (exp.type || "general");
      if (!cat) return;
      byCategory[cat] = (byCategory[cat] || 0) + myShare;
    });
  }));

  const catContainer = document.getElementById("activity-category-breakdown");
  catContainer.innerHTML = "";
  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    catContainer.innerHTML = `<p class="empty-hint">Nothing tracked yet this month.</p>`;
  } else {
    const max = entries[0][1];
    entries.forEach(([cat, amount]) => {
      const row = el("div", "category-bar-row");
      const pct = Math.round((amount / max) * 100);
      row.innerHTML = `
        <div class="category-bar-head">
          <span>${escapeHtml(capitalize(cat))}</span>
          <span class="mono">${formatMoney(amount)}</span>
        </div>
        <div class="category-bar-track"><div class="category-bar-fill" style="width:${pct}%"></div></div>
      `;
      catContainer.appendChild(row);
    });
  }
}

document.querySelectorAll('[data-view="activity"]').forEach(b => b.addEventListener("click", renderActivity));
document.querySelectorAll('[data-view-link="activity"]').forEach(b => b.addEventListener("click", renderActivity));

// ----------------------------------------------------------------
// NOTIFICATIONS
// ----------------------------------------------------------------

document.getElementById("notif-btn").addEventListener("click", () => {
  renderNotifications();
  openSheet("sheet-notifications");
});

function renderNotifications() {
  const container = document.getElementById("notifications-list");
  container.innerHTML = "";

  const hasAnything = state.friendRequests.length || state.groupInvites.length || state.notifications.length;
  if (!hasAnything) {
    container.innerHTML = `<p class="empty-hint">Nothing here yet.</p>`;
    return;
  }

  state.friendRequests.forEach(req => {
    const row = el("div", "ledger-row");
    row.style.cursor = "default";
    row.innerHTML = `
      <span class="ledger-avatar">${initials(req.senderName)}</span>
      <div class="ledger-main">
        <div class="ledger-title">${escapeHtml(req.senderName || "Someone")} wants to connect</div>
        <div class="ledger-sub">Contact request</div>
      </div>
    `;
    const actions = el("div");
    actions.style.display = "flex";
    actions.style.gap = "6px";
    const acceptBtn = el("button", "btn btn-primary btn-sm", "Accept");
    const declineBtn = el("button", "btn btn-outline btn-sm", "Decline");
    acceptBtn.addEventListener("click", async () => {
      await Data.respondToFriendRequest(req.id, true);
      showToast("Contact added.");
      renderNotifications();
    });
    declineBtn.addEventListener("click", async () => {
      await Data.respondToFriendRequest(req.id, false);
      renderNotifications();
    });
    actions.appendChild(acceptBtn);
    actions.appendChild(declineBtn);
    row.appendChild(actions);
    container.appendChild(row);
  });

  state.groupInvites.forEach(inv => {
    const row = el("div", "ledger-row");
    row.style.cursor = "default";
    row.innerHTML = `
      <span class="ledger-avatar">${initials(inv.groupName)}</span>
      <div class="ledger-main">
        <div class="ledger-title">${escapeHtml(inv.senderName || "Someone")} invited you to "${escapeHtml(inv.groupName)}"</div>
        <div class="ledger-sub">Group invitation</div>
      </div>
    `;
    const actions = el("div");
    actions.style.display = "flex";
    actions.style.gap = "6px";
    const acceptBtn = el("button", "btn btn-primary btn-sm", "Accept");
    const declineBtn = el("button", "btn btn-outline btn-sm", "Decline");
    acceptBtn.addEventListener("click", async () => {
      await Data.acceptGroupInvite(inv.id);
      showToast(`Joined "${inv.groupName}".`);
      renderNotifications();
    });
    declineBtn.addEventListener("click", async () => {
      await Data.declineGroupInvite(inv.id);
      renderNotifications();
    });
    actions.appendChild(acceptBtn);
    actions.appendChild(declineBtn);
    row.appendChild(actions);
    container.appendChild(row);
  });

  state.notifications.forEach(n => {
    container.appendChild(buildLedgerRow({
      avatarText: "🔔",
      title: n.title,
      sub: n.body
    }));
  });

  // Mark all visible notifications as read
  const unreadIds = state.notifications.filter(n => !n.read).map(n => n.id);
  if (unreadIds.length) Data.markAllNotificationsRead(state.user.uid, unreadIds);
}

document.getElementById("clear-notifications-btn").addEventListener("click", async () => {
  const ids = state.notifications.map(n => n.id);
  if (ids.length === 0) return;
  await Data.clearAllNotifications(state.user.uid, ids);
  renderNotifications();
});

// ----------------------------------------------------------------
// PROFILE / SETTINGS
// ----------------------------------------------------------------

document.getElementById("profile-btn").addEventListener("click", () => {
  if (!state.profile) return;
  document.querySelector('#profile-form input[name="displayName"]').value = state.profile.displayName || "";
  document.getElementById("profile-email").textContent = state.profile.email || "";
  openSheet("sheet-profile");
});

document.getElementById("profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await Data.updateUserProfile(state.user.uid, { displayName: fd.get("displayName").trim() });
    closeSheet();
    showToast("Profile updated.");
  } catch (err) {
    showToast(err.message || "Couldn't update your profile.", true);
  }
});

document.getElementById("signout-btn").addEventListener("click", async () => {
  await Auth.signOut();
  closeSheet();
});

// ----------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
