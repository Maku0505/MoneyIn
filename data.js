// ============================================================
// MoneyIn — Data layer (Firestore)
// ------------------------------------------------------------
// Since GitHub Pages can't host Cloud Functions, balance
// recomputation that DivAid does server-side happens here on
// the client, computed live from each group's expenses.
// ============================================================

import { db, auth } from "./firebase-config.js";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  collection, query, where, onSnapshot, serverTimestamp,
  arrayUnion, arrayRemove, writeBatch, getDocs, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------------------------------------------------------------
// Users
// ---------------------------------------------------------------

export function watchUserProfile(uid, callback) {
  return onSnapshot(doc(db, "users", uid), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

export async function updateUserProfile(uid, fields) {
  await updateDoc(doc(db, "users", uid), fields);
}

export async function toggleStarredGroup(uid, groupId, starred) {
  await updateDoc(doc(db, "users", uid), {
    starredGroups: starred ? arrayUnion(groupId) : arrayRemove(groupId)
  });
}

export async function toggleStarredFriend(uid, friendUid, starred) {
  await updateDoc(doc(db, "users", uid), {
    starredFriends: starred ? arrayUnion(friendUid) : arrayRemove(friendUid)
  });
}

export async function getUsersByIds(ids) {
  const results = {};
  await Promise.all(ids.map(async (id) => {
    const snap = await getDoc(doc(db, "users", id));
    if (snap.exists()) results[id] = { id: snap.id, ...snap.data() };
  }));
  return results;
}

// ---------------------------------------------------------------
// Contacts (friend requests)
// ---------------------------------------------------------------

export async function sendFriendRequest(targetUser, currentUser) {
  if (targetUser.id === currentUser.uid) {
    throw new Error("You can't add yourself as a contact.");
  }
  const profileSnap = await getDoc(doc(db, "users", currentUser.uid));
  const profile = profileSnap.data();
  if ((profile.friends || []).includes(targetUser.id)) {
    throw new Error("You're already connected with this person.");
  }

  // Check for an existing pending request either direction
  const existing = await getDocs(query(
    collection(db, "friend_requests"),
    where("senderId", "in", [currentUser.uid, targetUser.id]),
    where("status", "==", "pending")
  ));
  const duplicate = existing.docs.find(d => {
    const r = d.data();
    return (r.senderId === currentUser.uid && r.receiverId === targetUser.id) ||
           (r.senderId === targetUser.id && r.receiverId === currentUser.uid);
  });
  if (duplicate) throw new Error("A request is already pending with this person.");

  await addDoc(collection(db, "friend_requests"), {
    senderId: currentUser.uid,
    senderName: currentUser.displayName || "",
    receiverId: targetUser.id,
    receiverName: targetUser.displayName || "",
    status: "pending",
    createdAt: serverTimestamp()
  });

  // In-app notification for the receiver (no Cloud Functions trigger available)
  await addDoc(collection(db, "users", targetUser.id, "notifications"), {
    type: "friend_request",
    title: "New contact request",
    body: `${currentUser.displayName || "Someone"} wants to connect.`,
    read: false,
    createdAt: serverTimestamp()
  });
}

export function watchIncomingFriendRequests(uid, callback) {
  const q = query(
    collection(db, "friend_requests"),
    where("receiverId", "==", uid),
    where("status", "==", "pending")
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export async function respondToFriendRequest(requestId, accept) {
  const ref = doc(db, "friend_requests", requestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const req = snap.data();

  if (accept) {
    const batch = writeBatch(db);
    batch.update(doc(db, "users", req.senderId), { friends: arrayUnion(req.receiverId) });
    batch.update(doc(db, "users", req.receiverId), { friends: arrayUnion(req.senderId) });
    batch.delete(ref);
    await batch.commit();

    await addDoc(collection(db, "users", req.senderId, "notifications"), {
      type: "friend_accepted",
      title: "Contact request accepted",
      body: `${req.receiverName || "Your contact"} accepted your request.`,
      read: false,
      createdAt: serverTimestamp()
    });
  } else {
    await deleteDoc(ref);
  }
}

export async function removeContact(uid, friendUid) {
  const batch = writeBatch(db);
  batch.update(doc(db, "users", uid), { friends: arrayRemove(friendUid) });
  batch.update(doc(db, "users", friendUid), { friends: arrayRemove(uid) });
  await batch.commit();
}

// ---------------------------------------------------------------
// Groups
// ---------------------------------------------------------------

export async function createGroup({ name, description, type, createdBy }) {
  const ref = await addDoc(collection(db, "groups"), {
    name, description: description || "", type: type || "general",
    defaultCurrency: "EUR",
    photoUrl: null,
    members: [createdBy],
    createdBy,
    createdAt: serverTimestamp()
  });
  return ref.id;
}

export async function inviteToGroup(groupId, groupName, senderId, senderName, receiverId, receiverName) {
  await addDoc(collection(db, "group_invites"), {
    groupId, groupName, senderId, senderName,
    receiverId, receiverName,
    status: "pending",
    createdAt: serverTimestamp()
  });
  await addDoc(collection(db, "users", receiverId, "notifications"), {
    type: "group_invite",
    title: "Group invitation",
    body: `${senderName || "Someone"} invited you to "${groupName}".`,
    read: false,
    createdAt: serverTimestamp()
  });
}

export function watchUserGroups(uid, callback) {
  const q = query(collection(db, "groups"), where("members", "array-contains", uid));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export function watchGroup(groupId, callback) {
  return onSnapshot(doc(db, "groups", groupId), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

export async function updateGroup(groupId, fields) {
  await updateDoc(doc(db, "groups", groupId), fields);
}

export async function leaveGroup(groupId, uid) {
  const ref = doc(db, "groups", groupId);
  const snap = await getDoc(ref);
  const group = snap.data();
  const remaining = (group.members || []).filter(m => m !== uid);
  if (remaining.length === 0) {
    await deleteDoc(ref);
  } else {
    await updateDoc(ref, { members: arrayRemove(uid) });
  }
}

export function watchIncomingGroupInvites(uid, callback) {
  const q = query(
    collection(db, "group_invites"),
    where("receiverId", "==", uid),
    where("status", "==", "pending")
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export async function acceptGroupInvite(inviteId) {
  const ref = doc(db, "group_invites", inviteId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const invite = snap.data();

  await updateDoc(doc(db, "groups", invite.groupId), {
    members: arrayUnion(invite.receiverId)
  });
  await deleteDoc(ref);

  await addDoc(collection(db, "users", invite.senderId, "notifications"), {
    type: "group_invite_accepted",
    title: "Invitation accepted",
    body: `${invite.receiverName || "Someone"} joined "${invite.groupName}".`,
    read: false,
    createdAt: serverTimestamp()
  });
}

export async function declineGroupInvite(inviteId) {
  await deleteDoc(doc(db, "group_invites", inviteId));
}

// ---------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------

export function watchGroupExpenses(groupId, callback) {
  const q = query(collection(db, "groups", groupId, "expenses"), orderBy("date", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export async function addExpense(groupId, { description, type, totalAmount, date, createdBy, paidBy, splitBetween }) {
  await addDoc(collection(db, "groups", groupId, "expenses"), {
    description, type: type || "general",
    totalAmount, date,
    createdBy, paidBy, splitBetween,
    createdAt: serverTimestamp()
  });
}

export async function deleteExpense(groupId, expenseId) {
  await deleteDoc(doc(db, "groups", groupId, "expenses", expenseId));
}

/**
 * Records a settlement as a Payment-type expense, mirroring DivAid.
 * If `markOnly` is true, no wallet balance is touched (no real wallet here);
 * it simply records the debt as cleared.
 */
export async function createSettlement(groupId, { from, to, amount, createdBy }) {
  await addDoc(collection(db, "groups", groupId, "expenses"), {
    description: "Settlement",
    type: "Payment",
    totalAmount: amount,
    date: new Date().toISOString().slice(0, 10),
    createdBy,
    paidBy: { [from]: amount },
    splitBetween: { [to]: amount },
    createdAt: serverTimestamp()
  });

  await addDoc(collection(db, "users", to, "notifications"), {
    type: "settlement",
    title: "You got paid",
    body: `A settlement of €${amount.toFixed(2)} was recorded.`,
    read: false,
    createdAt: serverTimestamp()
  });
}

// ---------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------

export function watchNotifications(uid, callback) {
  const q = query(collection(db, "users", uid, "notifications"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export async function markAllNotificationsRead(uid, notifIds) {
  const batch = writeBatch(db);
  notifIds.forEach(id => {
    batch.update(doc(db, "users", uid, "notifications", id), { read: true });
  });
  await batch.commit();
}

export async function clearAllNotifications(uid, notifIds) {
  const batch = writeBatch(db);
  notifIds.forEach(id => {
    batch.delete(doc(db, "users", uid, "notifications", id));
  });
  await batch.commit();
}
