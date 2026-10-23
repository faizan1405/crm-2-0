import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Eye, EyeOff, Loader2, AlertCircle, Info } from "lucide-react";
import { ScaleMark } from "@/components/crm/Shell";
import { demoAuth } from "@/lib/crm/team";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in · Scale Flow Sales OS" },
      { name: "description", content: "Sign in to Scale Flow Sales OS with your own account." },
      { property: "og:title", content: "Sign in · Scale Flow Sales OS" },
      { property: "og:description", content: "Sign in to Scale Flow Sales OS with your own account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Login,
});

// Design foundation only: demoAuth never authenticates, compares passwords or issues tokens.
function Login() {
    const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return setError("Enter a valid email address.");
    if (!password) return setError("Enter your password.");
    setBusy(true);
    const r = await demoAuth.signIn(email, password);
    setBusy(false); setPassword("");
    if (!r.ok) setError(r.message);
  };
  return (
    <div className="login-page">
      <div className="login-brand" aria-hidden="true"><div className="flex items-center gap-3"><span className="sb-mark"><ScaleMark className="size-5" /></span><span className="text-lg font-semibold">Scale Flow</span></div><p className="login-tag">One CRM. Every seller in their own workspace.</p><span className="sb-os">Sales OS 3.0</span></div>
      <main className="login-card">
        <div className="mb-6 flex items-center gap-2 lg:hidden"><span className="sb-mark sb-mark-light"><ScaleMark className="size-4" /></span><span className="font-semibold">Scale Flow · Sales OS</span></div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">Use the email and password your administrator gave you.</p>
        <div className="tm-notice mt-5"><Info className="size-4 shrink-0" /><span>Preview only — sign-in needs the secure backend, which isn't connected yet. Nothing you type is saved.</span></div>
        <form className="mt-5 grid gap-4" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <label className="q-field"><span>Email</span><Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></label>
          {mode === "signin" && <label className="q-field"><span className="flex justify-between">Password</span>
            <span className="relative block"><Input type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="pr-10" /><button type="button" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow(!show)} className="absolute top-1/2 right-2 -translate-y-1/2 p-1 text-muted-foreground">{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></span></label>}
          {error && <p role="alert" className="flex items-center gap-2 text-sm font-medium text-destructive"><AlertCircle className="size-4 shrink-0" />{error}</p>}
          <Button type="submit" disabled={busy} className="h-11">{busy && <Loader2 className="animate-spin" />}Sign in</Button>
          <p className="text-center text-xs text-muted-foreground">Forgot your password? Contact your administrator to reset it.</p>
        </form>
        <Link to="/" className="mt-6 block text-center text-xs text-muted-foreground hover:underline">Back to the demo workspace</Link>
      </main>
    </div>
  );
}
