import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import {
  AuthSsrProvider,
  clearClientAuthState,
  hydrateAuthFromSsr,
  readInitialAuthState,
  refreshAuthSession,
  sanitizeRedirectTarget,
  subscribeAuthSync,
  useAuthStore,
  useResolvedAuthState,
} from "../lib/auth/authClient";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  staleTime: Infinity,
  loader: async () => await readInitialAuthState(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Scale Flow CRM" },
      {
        name: "description",
        content: "Scale Flow CRM 2.0 — leads, pipeline, follow-ups and payments.",
      },
      { property: "og:title", content: "Scale Flow CRM" },
      {
        property: "og:description",
        content: "Scale Flow CRM 2.0 — leads, pipeline, follow-ups and payments.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap",
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function buildLoginRedirectUrl(reason?: string): string {
  if (typeof window === "undefined") return "/login";
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const safe = sanitizeRedirectTarget(current);
  const params = new URLSearchParams();
  if (safe !== "/") params.set("redirect", safe);
  if (reason) params.set("reason", reason);
  const qs = params.toString();
  return qs ? `/login?${qs}` : "/login";
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const initialAuth = Route.useLoaderData();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { idleExpiresAt } = useResolvedAuthState();

  useEffect(() => {
    if (initialAuth?.checked && useAuthStore.getState().status === "unknown") {
      hydrateAuthFromSsr(initialAuth);
    }
  }, [initialAuth]);

  useEffect(() => {
    const verifyProtectedSession = async (forceRefresh = false) => {
      if (pathname === "/login") return;
      const snap = useAuthStore.getState();
      const stale =
        forceRefresh ||
        snap.status !== "authenticated" ||
        (snap.idleExpiresAt !== null && Date.now() >= Date.parse(snap.idleExpiresAt)) ||
        (snap.lastCheckedAt !== null && Date.now() - snap.lastCheckedAt > 30_000);

      if (!stale) return;
      const res = await refreshAuthSession();
      if (!res.ok) {
        window.location.replace(buildLoginRedirectUrl("db_unavailable"));
        return;
      }
      if (!res.authenticated) {
        const reason =
          res.reason === "idle_expired" || res.reason === "absolute_expired"
            ? "expired"
            : undefined;
        window.location.replace(buildLoginRedirectUrl(reason));
      }
    };

    void verifyProtectedSession(false);

    const onPageShow = (event: PageTransitionEvent) => {
      if (pathname !== "/login" && event.persisted) {
        clearClientAuthState();
        void verifyProtectedSession(true);
      }
    };
    const onPopState = () => {
      if (pathname !== "/login") {
        void verifyProtectedSession(true);
      }
    };
    const onFocusOrVisible = () => {
      if (pathname !== "/login" && document.visibilityState === "visible") {
        void verifyProtectedSession(false);
      }
    };

    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);

    const unsubscribeSync = subscribeAuthSync((event) => {
      if (event === "logout" || event === "logout_all") {
        clearClientAuthState();
        if (pathname !== "/login") {
          window.location.replace("/login");
        }
      } else if (event === "login" && pathname === "/login") {
        window.location.replace("/");
      }
    });

    let expiryTimer: number | undefined;
    if (pathname !== "/login" && idleExpiresAt) {
      const deadlineMs = Date.parse(idleExpiresAt);
      if (!Number.isNaN(deadlineMs)) {
        const delayMs = Math.min(Math.max(deadlineMs - Date.now() + 250, 500), 2_147_483_000);
        expiryTimer = window.setTimeout(() => {
          void verifyProtectedSession(true);
        }, delayMs);
      }
    }

    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
      unsubscribeSync();
      if (expiryTimer !== undefined) {
        window.clearTimeout(expiryTimer);
      }
    };
  }, [pathname, idleExpiresAt]);

  return (
    <AuthSsrProvider value={initialAuth ?? null}>
      <QueryClientProvider client={queryClient}>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
        <Toaster richColors position="top-right" />
      </QueryClientProvider>
    </AuthSsrProvider>
  );
}
