import { fetch } from "expo/fetch";
import { QueryClient, QueryCache, QueryFunction } from "@tanstack/react-query";

/**
 * Gets the base URL for the Express API server (e.g., "http://localhost:3000")
 * @returns {string} The API base URL
 */
const PRODUCTION_DOMAIN = "vrt-sync-mobile.replit.app";

export function getApiUrl(): string {
  let host = process.env.EXPO_PUBLIC_DOMAIN;

  if (!host) {
    if (__DEV__) {
      throw new Error("EXPO_PUBLIC_DOMAIN is not set");
    }
    host = PRODUCTION_DOMAIN;
  }

  let url = new URL(`https://${host}`);

  return url.href;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
  signal?: AbortSignal,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const res = await fetch(url.toString(), {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
    signal,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey, signal }) => {
    const baseUrl = getApiUrl();
    const url = new URL(queryKey.join("/") as string, baseUrl);

    const controller = new AbortController();
    let didTimeout = false;
    const timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, 15000);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      controller.abort();
    });

    try {
      const res = await fetch(url.toString(), {
        credentials: "include",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      return await res.json();
    } catch (err) {
      clearTimeout(timeoutId);
      if (didTimeout && err instanceof Error && err.name === 'AbortError') {
        throw new Error('Request timed out. Please check your connection and try again.');
      }
      throw err;
    }
  };

function isAuthError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message;
    return msg.startsWith("401:");
  }
  return false;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
      onError: (error: Error) => {
        if (isAuthError(error)) {
          queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
        }
      },
    },
  },
  queryCache: new QueryCache({
    onError: (error: Error, query) => {
      if (query.queryKey[0] === "/api/auth/me") return;
      if (isAuthError(error)) {
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      }
    },
  }),
});
