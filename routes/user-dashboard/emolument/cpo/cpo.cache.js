"use strict";

const TTL_MS = 60 * 1000;
const store = new Map(); // key -> { value, expires }

async function getCachedOrCompute(key, compute, { force = false, ttl = TTL_MS } = {}) {
  const hit = store.get(key);
  if (!force && hit && hit.expires > Date.now()) {
    return { ...hit.value, cached: true };
  }
  const value = await compute();
  store.set(key, { value, expires: Date.now() + ttl });
  return { ...value, cached: false };
}

function invalidate(key) {
  if (key) store.delete(key);
  else store.clear();
}

function invalidatePrefix(prefix) {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}

module.exports = { getCachedOrCompute, invalidate, invalidatePrefix };