import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, AlertCircle, Info, Crown, Users, ShieldCheck } from "lucide-react";
import { ScaleMark } from "@/components/crm/Shell";
import {
  loginWithOwnerCredentials,
  sanitizeRedirectTarget,
  useAuthStore,
} from "@/lib/auth/authClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LoginSearch = {
  redirect?: string;
  reason?: string;
};

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): LoginSearch => {
    const out: LoginSearch = {};
    if (typeof s["redirect"] === "string") {
      out.redirect = sanitizeRedirectTarget(s["redirect"]);
    }
    if (typeof s["reason"] === "string") {
      out.reason = s["reason"];
    }
    return out;
  },
  head: () => ({
    meta: [
      { title: "Sign in · Scale Flow Sales OS" },
      { name: "description", content: "Sign in to Scale Flow Sales OS with your own account." },
      { property: "og:title", content: "Sign in · Scale Flow Sales OS" },
      {
        property: "og:description",
        content: "Sign in to Scale Flow Sales OS with your own account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Login,
});

export type Portal = "owner" | "employee";

function Login() {
  const { redirect, reason } = Route.useSearch();
  const authStatus = useAuthStore((s) => s.status);
  const [portal, setPortal] = useState<Portal>("owner");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const safeTarget = sanitizeRedirectTarget(redirect);

  useEffect(() => {
    if (authStatus === "authenticated") {
      window.location.replace(safeTarget);
    }
  }, [authStatus, safeTarget]);

  const submit = async (form?: HTMLFormElement | null) => {
    if (portal !== "owner" || busy) return;
    setError(null);
    const fd = form ? new FormData(form) : null;
    const rawEmail = fd ? String(fd.get("email") ?? email) : email;
    const rawPassword = fd ? String(fd.get("password") ?? password) : password;
    const cleanedEmail = rawEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (!rawPassword) {
      setError("Enter your password.");
      return;
    }

    setBusy(true);
    const result = await loginWithOwnerCredentials(cleanedEmail, rawPassword);
    setPassword("");

    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      return;
    }

    window.location.assign(safeTarget);
  };

  if (authStatus === "authenticated") {
    return (
      <div className="login-page">
        <div className="login-brand" aria-hidden="true">
          <div className="flex items-center gap-3">
            <span className="sb-mark">
              <ScaleMark className="size-5" />
            </span>
            <span className="text-lg font-semibold">Scale Flow</span>
          </div>
          <p className="login-tag">One CRM. Every seller in their own workspace.</p>
          <span className="sb-os">Sales OS 3.0</span>
        </div>
        <main className="login-card">
          <p className="text-sm text-muted-foreground">Signed in. Opening your workspace…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-brand" aria-hidden="true">
        <div className="flex items-center gap-3">
          <span className="sb-mark">
            <ScaleMark className="size-5" />
          </span>
          <span className="text-lg font-semibold">Scale Flow</span>
        </div>
        <p className="login-tag">One CRM. Every seller in their own workspace.</p>
        <span className="sb-os">Sales OS 3.0</span>
      </div>
      <main className="login-card">
        <div className="mb-6 flex items-center gap-2 lg:hidden">
          <span className="sb-mark sb-mark-light">
            <ScaleMark className="size-4" />
          </span>
          <span className="font-semibold">Scale Flow · Sales OS</span>
        </div>
        <div className="login-switch mb-6" role="group" aria-label="Choose how to sign in">
          <button
            type="button"
            aria-pressed={portal === "owner"}
            onClick={() => {
              setPortal("owner");
              setError(null);
              setPassword("");
            }}
          >
            <Crown className="size-4" />
            Owner login
          </button>
          <button
            type="button"
            aria-pressed={portal === "employee"}
            onClick={() => {
              setPortal("employee");
              setError(null);
              setPassword("");
            }}
          >
            <Users className="size-4" />
            Employee login
          </button>
        </div>
        <div key={portal} className="login-form-anim">
          <h1 className="text-2xl font-semibold tracking-tight">
            {portal === "owner" ? "Owner sign in" : "Employee sign in"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {portal === "owner"
              ? "Server-verified Owner access with encrypted password verification and HttpOnly sessions."
              : "Employee accounts are not enabled yet in this release."}
          </p>

          {portal === "owner" && reason === "expired" && (
            <div className="tm-notice mt-5" role="status">
              <Info className="size-4 shrink-0" />
              <span>Your session timed out or ended. Sign in again to continue.</span>
            </div>
          )}

          {portal === "owner" && reason === "db_unavailable" && (
            <div className="tm-notice mt-5" role="status">
              <AlertCircle className="size-4 shrink-0" />
              <span>
                Authentication database is not configured or reachable. Check server DB settings
                before signing in.
              </span>
            </div>
          )}

          {portal === "owner" ? (
            <form
              className="mt-5 grid gap-4"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void submit(e.currentTarget);
              }}
            >
              <label className="q-field">
                <span>Owner email</span>
                <Input
                  type="email"
                  name="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  disabled={busy}
                />
              </label>
              <label className="q-field">
                <span>Password</span>
                <span className="relative block">
                  <Input
                    type={show ? "text" : "password"}
                    name="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                    disabled={busy}
                  />
                  <button
                    type="button"
                    aria-label={show ? "Hide password" : "Show password"}
                    onClick={() => setShow(!show)}
                    className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-muted-foreground"
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </span>
              </label>
              {error && (
                <p
                  role="alert"
                  className="flex items-center gap-2 text-sm font-medium text-destructive"
                >
                  <AlertCircle className="size-4 shrink-0" />
                  <span>{error}</span>
                </p>
              )}
              <Button type="submit" disabled={busy} className="h-11">
                {busy && <Loader2 className="animate-spin" />}
                Sign in as Owner
              </Button>
              <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
                <ShieldCheck className="size-3.5 shrink-0" />
                <span>
                  Protected workspace · Browser-local CRM data remains preserved on this device.
                </span>
              </p>
            </form>
          ) : (
            <div className="mt-5 grid gap-4">
              <div className="tm-notice" role="status">
                <Info className="size-4 shrink-0" />
                <span>
                  Unavailable right now — Employee sign-in activates in a later Team CRM checkpoint.
                  Switch back to <b>Owner login</b> to sign in.
                </span>
              </div>
              <label className="q-field opacity-60">
                <span>Employee email</span>
                <Input type="email" value="" placeholder="Unavailable in B1B" disabled />
              </label>
              <label className="q-field opacity-60">
                <span>Password</span>
                <Input type="password" value="" placeholder="Unavailable in B1B" disabled />
              </label>
              <Button type="button" disabled className="h-11">
                Employee sign-in unavailable
              </Button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
