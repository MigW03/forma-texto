/**
 * Persists the user's selected file across the checkout flow using IndexedDB — a
 * plain in-memory variable used to hold this, and was wiped by ANY same-origin
 * reload between file selection and payment confirmation (a page refresh, the
 * browser back/forward cache, or a payment redirect). `handleSuccess` in
 * CheckoutPage.tsx would then silently create the project with no file at all;
 * the server flags it `missing_file` and the user has to manually re-upload after
 * already paying (see the comment in `processFormatting.ts`). IndexedDB is
 * disk-backed and survives all of that, so this loss should now be rare —
 * `getStoredFile` resolving to `null` is still handled explicitly by the caller
 * (never silently swallowed) as a fallback for whatever residual case remains
 * (e.g. a private-browsing mode that blocks IndexedDB entirely).
 */

const DB_NAME = 'scriba-file-store'
const STORE_NAME = 'files'
const KEY = 'current-upload'

/** Distinct slot for the file dropped on the landing page's Hero card, pre-auth — kept
 *  separate from the checkout-flow slot above so an abandoned checkout's leftover file
 *  can never be mistaken for (and silently restored as) a fresh Hero upload, or vice versa. */
export const HERO_UPLOAD_KEY = 'hero-upload'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function storeFile(file: File | null, key: string = KEY): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      if (file) store.put(file, key)
      else store.delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (err) {
    console.error('storeFile failed:', err)
  }
}

export async function getStoredFile(key: string = KEY): Promise<File | null> {
  try {
    const db = await openDb()
    const file = await new Promise<File | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(key)
      req.onsuccess = () => resolve((req.result as File | undefined) ?? null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return file
  } catch (err) {
    console.error('getStoredFile failed:', err)
    return null
  }
}

/** Clear the stored file once it's been used (successfully or not) so it isn't reused by a later, unrelated checkout. */
export async function clearStoredFile(key: string = KEY): Promise<void> {
  await storeFile(null, key)
}

/**
 * sessionStorage key for the one-shot handoff of a file/link the user provided on the
 * landing page's Hero card before authenticating. A dedicated key, separate from
 * GetStartedPage's own `SESSION_KEY` — that one is wiped by Dashboard's "New service"
 * button (`clearGetStartedSession`) to start a clean form, which would otherwise also
 * silently eat this handoff before it's ever read. Its mere presence also tells
 * AuthPage/HomeRoute to land the user back on /get-started instead of /dashboard after
 * they authenticate — see those files.
 */
export const HERO_HANDOFF_KEY = 'scriba-hero-handoff'

/** Clears any pending Hero handoff (marker + the file in IndexedDB) — used wherever a
 *  "start a brand-new service" action happens, so a leftover from an abandoned session
 *  can never resurface later. */
export function clearHeroHandoff(): void {
  sessionStorage.removeItem(HERO_HANDOFF_KEY)
  clearStoredFile(HERO_UPLOAD_KEY)
}
