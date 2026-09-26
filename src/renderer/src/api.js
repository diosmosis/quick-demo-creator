// window.api with main's { ok, value } / { ok: false, error, data } answers
// turned back into values and thrown Errors (see src/preload/index.js).
const unwrap =
  (fn) =>
  async (...args) => {
    const res = await fn(...args)
    if (res.ok) return res.value
    throw Object.assign(new Error(res.error), { data: res.data })
  }

// Not IPC calls, so there is no { ok, value } to unwrap.
const UNWRAPPED = new Set(['onJobEvent', 'pathForFile'])

export const api = Object.fromEntries(
  Object.entries(window.api).map(([name, fn]) => [name, UNWRAPPED.has(name) ? fn : unwrap(fn)])
)
