// ============================================================================
// FIREBASE STUB — v1.24.0
//
// The Firebase SDK has been removed from this project. Nothing here talks to
// Firebase, and no Firebase code ships in the bundle.
//
// ---------------------------------------------------------------------------
// WHY A STUB RATHER THAN DELETING THE CALL SITES
// ---------------------------------------------------------------------------
// 218 Firestore calls remained across 34 files. Every one of them already sat
// behind a backend guard — `firestoreUnavailable()`, `usingSupabaseAuth()` or
// `useSupabaseBackend()` — so on Supabase they were already unreachable.
//
// Deleting 218 call sites by hand across a POS that restaurants bill on is a
// large, risky edit for no functional gain: the code was already dead. This
// module satisfies the imports so the project compiles, while making it
// impossible for any of that code to reach a network.
//
// If some path is ever reached that was NOT properly guarded, it throws a
// clear, named error instead of silently doing nothing. A loud failure in an
// unreachable branch is exactly what we want: it names the file to fix rather
// than quietly losing a bill.
//
// The legacy branches can now be deleted file by file at leisure, each one
// verified on its own, with no deadline pressure and no risk of a half-done
// refactor reaching a till.
// ============================================================================

const REMOVED =
  'Firebase has been removed from DT POS. This code path should be unreachable — '
  + 'it means a backend guard is missing. Please report which screen produced this.';

function gone(api: string): any {
  throw new Error(`[firebase-removed] ${api}() — ${REMOVED}`);
}

// --- firebase/app ---------------------------------------------------------
export function initializeApp(..._a: any[]): any { return gone('initializeApp'); }
export function getApp(..._a: any[]): any { return gone('getApp'); }
export function getApps(..._a: any[]): any[] { return []; }        // safe: "none initialised"
export function deleteApp(..._a: any[]): void { /* nothing to delete */ }

// --- firebase/auth --------------------------------------------------------
export function getAuth(..._a: any[]): any { return gone('getAuth'); }
export function signInWithEmailAndPassword(..._a: any[]): any { return gone('signInWithEmailAndPassword'); }
export function createUserWithEmailAndPassword(..._a: any[]): any { return gone('createUserWithEmailAndPassword'); }
export function sendPasswordResetEmail(..._a: any[]): any { return gone('sendPasswordResetEmail'); }
export function signOut(..._a: any[]): Promise<void> { return Promise.resolve(); }  // sign-out must never throw
export function deleteUser(..._a: any[]): any { return gone('deleteUser'); }
export function setPersistence(..._a: any[]): Promise<void> { return Promise.resolve(); }
export const browserLocalPersistence = 'local';
export const browserSessionPersistence = 'session';
export const indexedDBLocalPersistence = 'indexeddb';
/** Reports "signed out" once, then does nothing. Never fires again. */
export function onAuthStateChanged(_auth: any, cb: any, ..._r: any[]): () => void {
  try { cb(null); } catch { /* ignore */ }
  return () => {};
}

// --- firebase/firestore ---------------------------------------------------
export function getFirestore(..._a: any[]): any { return gone('getFirestore'); }
export function initializeFirestore(..._a: any[]): any { return gone('initializeFirestore'); }
export function collection(..._a: any[]): any { return gone('collection'); }
export function collectionGroup(..._a: any[]): any { return gone('collectionGroup'); }
export function doc(..._a: any[]): any { return gone('doc'); }
export function getDoc(..._a: any[]): any { return gone('getDoc'); }
export function getDocFromServer(..._a: any[]): any { return gone('getDocFromServer'); }
export function getDocsFromServer(..._a: any[]): any { return gone('getDocsFromServer'); }
export function getDocs(..._a: any[]): any { return gone('getDocs'); }
export function setDoc(..._a: any[]): any { return gone('setDoc'); }
export function addDoc(..._a: any[]): any { return gone('addDoc'); }
export function updateDoc(..._a: any[]): any { return gone('updateDoc'); }
export function deleteDoc(..._a: any[]): any { return gone('deleteDoc'); }
export function writeBatch(..._a: any[]): any { return gone('writeBatch'); }
export function runTransaction(..._a: any[]): any { return gone('runTransaction'); }
export function query(..._a: any[]): any { return gone('query'); }
export function where(..._a: any[]): any { return gone('where'); }
export function orderBy(..._a: any[]): any { return gone('orderBy'); }
export function limit(..._a: any[]): any { return gone('limit'); }
export function startAfter(..._a: any[]): any { return gone('startAfter'); }
export function serverTimestamp(..._a: any[]): any { return new Date().toISOString(); }
export function increment(n: number): number { return n; }
export function arrayUnion(...v: unknown[]): unknown[] { return v; }
export function arrayRemove(...v: unknown[]): unknown[] { return v; }
export function persistentLocalCache(..._a: any[]): any { return {}; }
export function persistentMultipleTabManager(..._a: any[]): any { return {}; }
export function memoryLocalCache(..._a: any[]): any { return {}; }
/** Attaches nothing and never fires — callers already guard for this. */
export function onSnapshot(..._a: any[]): () => void { return () => {}; }

export type Timestamp = { toDate(): Date; toMillis(): number };
export const Timestamp = {
  now: () => ({ toDate: () => new Date(), toMillis: () => Date.now() }),
  fromDate: (d: Date) => ({ toDate: () => d, toMillis: () => d.getTime() }),
  fromMillis: (ms: number) => ({ toDate: () => new Date(ms), toMillis: () => ms }),
};

// --- firebase/storage -----------------------------------------------------
export function getStorage(..._a: any[]): any { return gone('getStorage'); }
export function ref(..._a: any[]): any { return gone('ref'); }
export function uploadBytes(..._a: any[]): any { return gone('uploadBytes'); }
export function uploadString(..._a: any[]): any { return gone('uploadString'); }
export function getDownloadURL(..._a: any[]): any { return gone('getDownloadURL'); }
export function deleteObject(..._a: any[]): any { return gone('deleteObject'); }
export function listAll(..._a: any[]): any { return gone('listAll'); }

// Types referenced across the codebase.
export type Unsubscribe = () => void;
// These are all `any` deliberately. Every consumer is dead code behind a
// backend guard; typing them precisely would mean re-deriving the whole
// Firebase type surface for branches that can never execute.
export type FirebaseApp = any;
export type Auth = any;
export type Firestore = any;
export type FirebaseStorage = any;
export type CollectionReference = any;
export type DocumentReference = any;
export type Query = any;
export type WriteBatch = any;
export type StorageReference = any;
export type QuerySnapshot = any;
export type DocumentData = any;
export type QueryDocumentSnapshot = any;
export type DocumentSnapshot = any;
export type FirestoreError = Error;
export type User = { uid: string; email: string | null; displayName?: string | null };
