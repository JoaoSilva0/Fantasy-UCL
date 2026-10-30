import { prisma } from "../db";

export class ProviderUnavailableError extends Error {}

/**
 * Cache em BD para reduzir chamadas à API.
 *  - Dentro do TTL: devolve a cache.
 *  - Expirada: tenta a API (com retry/backoff); se falhar, devolve a cache antiga (stale) — fallback.
 *  - Sem cache e API indisponível: lança ProviderUnavailableError.
 */
export async function cached<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<{ value: T; stale: boolean }> {
  const hit = await prisma.apiCache.findUnique({ where: { key } });
  if (hit && hit.expiresAt > new Date()) return { value: hit.value as T, stale: false };
  try {
    const value = await withRetry(fetcher);
    await prisma.apiCache.upsert({
      where: { key },
      create: { key, value: value as object, expiresAt: new Date(Date.now() + ttlSeconds * 1000) },
      update: { value: value as object, fetchedAt: new Date(), expiresAt: new Date(Date.now() + ttlSeconds * 1000) },
    });
    return { value, stale: false };
  } catch (e) {
    if (hit) {
      console.warn(`[cache] a usar dados em cache (stale) para ${key}:`, (e as Error).message);
      return { value: hit.value as T, stale: true };
    }
    throw new ProviderUnavailableError((e as Error).message);
  }
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (e instanceof NonRetryableError) break;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw last;
}

export class NonRetryableError extends Error {}
