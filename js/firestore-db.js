/* ═══════════════════════════════════════════════════════════════════
   FIRESTORE DATA LAYER — profiles & clubs
   ---------------------------------------------------------------------
   Profile and club data live in Firebase (Firestore) so they persist
   regardless of which Supabase region the player has picked for
   matchmaking (see js/supabase.js for the region system). Everything
   else — lobby rooms, tournaments, matchmaking, shop popularity —
   stays on Supabase; those are genuinely tied to a specific region's
   live server, not portable identity data.

   This is a small, deliberately narrow helper — not a full Supabase-
   compatible query builder. Firestore can't do arbitrary OR/ILIKE
   queries the way Postgres can, so callers that need "search" filter
   client-side over a bounded fetch (see clubs.js searchClubs()) rather
   than pretending Firestore can do it server-side.

   Collections:
     profiles/{uid}         — one document per user, uid = Firebase UID
     clubs/{clubId}         — one document per club, auto-generated id

   Exposed as window._fs.* — a plain async function set, not a fluent
   query builder, since the actual usage across this codebase is simple
   enough (get one doc, set one doc, update fields, delete, list/order a
   collection) that a builder API would just be ceremony.
   ═══════════════════════════════════════════════════════════════════ */

let _fsDb = null;
function _fsInit() {
    if (_fsDb) return _fsDb;
    if (typeof _fbInit === 'function') _fbInit(); // ensure the Firebase app exists
    if (typeof firebase === 'undefined' || !firebase.firestore) {
        console.error('[DR Firestore] Firebase Firestore SDK not loaded — check the <script> tags in index.html');
        return null;
    }
    _fsDb = firebase.firestore();
    return _fsDb;
}

/* Get one document. Returns the data object (with `id` merged in) or
   null if it doesn't exist. Mirrors the .maybeSingle() shape callers
   were already written against. */
async function fsGet(collection, id) {
    const db = _fsInit();
    if (!db || !id) return null;
    try {
        const snap = await db.collection(collection).doc(id).get();
        return snap.exists ? { id: snap.id, ...snap.data() } : null;
    } catch (e) {
        console.error(`[DR Firestore] get failed (${collection}/${id}):`, e);
        return null;
    }
}

/* Create or fully/partially write a document. merge:true (default)
   behaves like Supabase's upsert — only touches the given fields and
   creates the doc if it doesn't exist yet. merge:false overwrites the
   whole document. */
async function fsSet(collection, id, data, merge = true) {
    const db = _fsInit();
    if (!db || !id) return { error: { message: 'Firestore not ready' } };
    try {
        await db.collection(collection).doc(id).set(data, { merge });
        return { error: null };
    } catch (e) {
        console.error(`[DR Firestore] set failed (${collection}/${id}):`, e);
        return { error: e };
    }
}

/* Update specific fields on an existing document. Unlike fsSet, this
   fails if the document doesn't exist yet — use fsSet(..., true) if
   the doc might not exist. */
async function fsUpdate(collection, id, data) {
    const db = _fsInit();
    if (!db || !id) return { error: { message: 'Firestore not ready' } };
    try {
        await db.collection(collection).doc(id).update(data);
        return { error: null };
    } catch (e) {
        console.error(`[DR Firestore] update failed (${collection}/${id}):`, e);
        return { error: e };
    }
}

/* Add a new document with an auto-generated id. Returns the new id. */
async function fsAdd(collection, data) {
    const db = _fsInit();
    if (!db) return { id: null, error: { message: 'Firestore not ready' } };
    try {
        const ref = await db.collection(collection).add(data);
        return { id: ref.id, error: null };
    } catch (e) {
        console.error(`[DR Firestore] add failed (${collection}):`, e);
        return { id: null, error: e };
    }
}

async function fsDelete(collection, id) {
    const db = _fsInit();
    if (!db || !id) return { error: { message: 'Firestore not ready' } };
    try {
        await db.collection(collection).doc(id).delete();
        return { error: null };
    } catch (e) {
        console.error(`[DR Firestore] delete failed (${collection}/${id}):`, e);
        return { error: e };
    }
}

/* List documents in a collection, optionally ordered and/or limited.
   For "search", callers fetch a bounded, ordered batch and filter
   client-side (see clubs.js) — Firestore has no ILIKE/OR equivalent
   worth faking here. */
async function fsList(collection, { orderByField = null, ascending = false, limit = 50 } = {}) {
    const db = _fsInit();
    if (!db) return [];
    try {
        let q = db.collection(collection);
        if (orderByField) q = q.orderBy(orderByField, ascending ? 'asc' : 'desc');
        q = q.limit(limit);
        const snap = await q.get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
        console.error(`[DR Firestore] list failed (${collection}):`, e);
        return [];
    }
}

/* Query a collection where a field equals a value (used for e.g.
   "find the club with this tag" or "find profiles in this club"). */
async function fsWhere(collection, field, value, limit = 25) {
    const db = _fsInit();
    if (!db) return [];
    try {
        const snap = await db.collection(collection).where(field, '==', value).limit(limit).get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
        console.error(`[DR Firestore] where failed (${collection}.${field}==${value}):`, e);
        return [];
    }
}

window._fs = { fsGet, fsSet, fsUpdate, fsAdd, fsDelete, fsList, fsWhere };
