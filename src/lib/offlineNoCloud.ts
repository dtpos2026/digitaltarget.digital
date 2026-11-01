// ============================================================
// OFFLINE BUILD — inert "no cloud" layer.
// ------------------------------------------------------------
// DT POS is a 100% offline Windows application: there is no cloud
// SDK, no network client and no remote database anywhere in the
// bundle. All data lives in AppData (Electron JSON DB) and
// localStorage.
//
// A large amount of legacy code was written against a cloud
// document API. Rather than rip those call sites out one by one
// (and risk changing working billing/reporting logic), every one
// of them now resolves to the inert helpers below: each call is a
// no-op, every read returns an empty snapshot, and `isCloudConfigured()`
// is permanently false so the cloud branches are unreachable.
// ============================================================
/* eslint-disable @typescript-eslint/no-explicit-any --
   `any` is the point of this module: it stands in for a document-store SDK
   at dozens of legacy call sites without forcing a type-level rewrite of
   code paths that can never execute. */

/** Cloud mode is permanently OFF in the offline build. */
export const isCloudConfigured = (): boolean => false;

export const SUPER_ADMIN_EMAILS: string[] = [];
export function isSuperAdminEmail(_email?: string | null): boolean { return false; }

// Silent stub — any property access returns a no-op so legacy call sites
// (that forgot to guard with isCloudConfigured()) never crash.
const stub: any = new Proxy(function () {}, {
  get: () => stub,
  apply: () => stub,
  construct: () => stub,
});

const emptySnap: any = {
  empty: true, size: 0, docs: [] as any[],
  forEach: (_cb: any) => {},
  exists: () => false, data: () => undefined,
};

export function cloudApp(): any { return stub; }
export function cloudAuth(): any { return stub; }
export function cloudDb(): any { return stub; }
export function cloudStorage(): any { return stub; }

// ===== Inert document-store API (shape-compatible with the old call sites) =====
export const initializeApp: any = () => stub;
export const getApps: any = () => [];
export const getApp: any = () => stub;

export const getAuth: any = () => stub;
export const setPersistence: any = async () => {};
export const browserLocalPersistence: any = stub;
export const indexedDBLocalPersistence: any = stub;
export const onAuthStateChanged: any = (_a: any, cb: any) => {
  // Report "signed out" once, then never again — there is no auth service.
  try { if (cb) cb(null); } catch { /* listener threw */ }
  return () => {};
};
export const signOut: any = async () => {};
export const signInWithEmailAndPassword: any = async () => { throw new Error('offline'); };
export const createUserWithEmailAndPassword: any = async () => { throw new Error('offline'); };
export const sendPasswordResetEmail: any = async () => {};
export const GoogleAuthProvider: any = stub;
export const signInWithPopup: any = async () => { throw new Error('offline'); };
export type Auth = any;
export type User = any;

export const initializeDocStore: any = () => stub;
export const getDocStore: any = () => stub;
export const persistentLocalCache: any = () => stub;
export const persistentMultipleTabManager: any = () => stub;
export const collection: any = () => stub;
export const collectionGroup: any = () => stub;
export const doc: any = () => stub;
export const query: any = () => stub;
export const orderBy: any = () => stub;
export const limit: any = () => stub;
export const where: any = () => stub;
export const getDoc: any = async () => emptySnap;
export const getDocFromServer: any = async () => emptySnap;
export const getDocs: any = async () => emptySnap;
export const getDocsFromServer: any = async () => emptySnap;
export const enableIndexedDbPersistence: any = async () => {};
export const enableNetwork: any = async () => {};
export const disableNetwork: any = async () => {};
export const connectDocStoreEmulator: any = () => {};
export const increment: any = (n: number) => n;
export const arrayUnion: any = (...args: any[]) => args;
export const arrayRemove: any = (...args: any[]) => args;
export const startAfter: any = () => stub;
export const startAt: any = () => stub;
export const endAt: any = () => stub;
export const endBefore: any = () => stub;
export const setDoc: any = async () => {};
export const addDoc: any = async () => ({ id: 'offline' });
export const updateDoc: any = async () => {};
export const deleteDoc: any = async () => {};
export const onSnapshot: any = () => () => {};
export const serverTimestamp: any = () => new Date();
export const Timestamp: any = stub;
/** Legacy timestamp shape — offline builds always store plain epoch millis. */
export type TimestampLike = any;
export const writeBatch: any = () => ({ set: () => {}, update: () => {}, delete: () => {}, commit: async () => {} });
export const runTransaction: any = async () => {};
export type DocStore = any;
export type Unsubscribe = () => void;
export type DocumentData = any;
export type QuerySnapshot = any;
export type DocumentSnapshot = any;

export const getStorage: any = () => stub;
export const ref: any = () => stub;
export const uploadBytes: any = async () => ({ ref: stub });
export const uploadString: any = async () => ({ ref: stub });
export const getDownloadURL: any = async () => '';
export const deleteObject: any = async () => {};

export default stub;
