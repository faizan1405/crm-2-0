import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { User, Palette, Clock, SlidersHorizontal, Bell, Shield, Database, Sun, Moon, Monitor, Download } from "lucide-react";
import { Shell, selectCls } from "@/components/crm/Shell";
import { AppShellSkeleton } from "@/components/crm/ShellPrimitives";
import { PilotSettingsPage } from "@/components/pilot/PilotSettingsPage";
import { useCRM, type Prefs } from "@/lib/crm/store";
import { TIMEZONE, formatDateTime, initials } from "@/lib/crm/format";
import { logoutOwner, useResolvedAuthState } from "@/lib/auth/authClient";
import { setLeadPilotSessionOptIn } from "@/lib/api/pilotGate";
import { parsePilotSearch, useLeadPilotState } from "@/lib/api/pilotHook";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/crm/session";
import { StorageDiagnostic } from "@/components/crm/StorageDiagnostic";

type SettingsSearch = { section?: string | undefined; pilot?: 1 | 0 | undefined };

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Settings · Scale Flow CRM" },
      { name: "description", content: "Profile, appearance, preferences and demo data." },
      { property: "og:title", content: "Settings · Scale Flow CRM" },
      { property: "og:description", content: "Profile, appearance, preferences and demo data." },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): SettingsSearch => {
    const pilotObj = parsePilotSearch(s);
    return {
      ...(typeof s["section"] === "string" && s["section"] ? { section: s["section"] } : {}),
      ...(pilotObj.pilot !== undefined ? { pilot: pilotObj.pilot } : {}),
    };
  },
  component: SettingsEntry,
});

function SettingsEntry() {
  const search = Route.useSearch();
  const { pilotActive, pilotResolved } = useLeadPilotState(search.pilot);

  if (pilotActive) {
    return <PilotSettingsPage search={search} />;
  }
  if (!pilotResolved) {
    return <AppShellSkeleton />;
  }
  return <Settings />;
}

const SECTIONS = [
  { id: "profile", label: "Profile & account", icon: User },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "datetime", label: "Date & time", icon: Clock },
  { id: "crm", label: "CRM preferences", icon: SlidersHorizontal },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security", label: "Security", icon: Shield },
  { id: "data", label: "Data & backup", icon: Database },
] as const;
type Sec = (typeof SECTIONS)[number]["id"];

const Pending = () => <span className="rounded-full bg-neutral-soft px-2 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase">Available after backend setup</span>;

function Settings() {
  const s = useCRM();
  const { section } = Route.useSearch();
  const navigate = useNavigate({ from: "/settings" });
  const [sec, setSec] = useState<Sec>(SECTIONS.some((x) => x.id === section) ? (section as Sec) : "profile");
  const pv = useSession((x) => x.preview);
  const [owner, setOwner] = useState(s.owner);
  const [business, setBusiness] = useState(s.business);
  const [email, setEmail] = useState(s.email);
  const { user: authUser, idleExpiresAt, expiresAt, status: authStatus, leadPilotAvailable: serverPilotAvailable } = useResolvedAuthState();
  const leadPilotAvailable = authStatus === "authenticated" && serverPilotAvailable;
  const [sessionBusy, setSessionBusy] = useState<"logout" | "logout-all" | null>(null);
  const p = (patch: Partial<Prefs>) => { s.preferences(patch); toast.success("Preference saved"); };
  const Choice = <T extends string>({ value, options, onChange }: { value: T; options: readonly (readonly [T, string, React.ReactNode?])[]; onChange: (v: T) => void }) => (
    <div className="flex flex-wrap gap-2">{options.map(([v, l, icon]) => <Button variant="outline" key={v} onClick={() => onChange(v)} className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors", value === v ? "border-primary bg-primary-soft text-primary" : "hover:border-foreground/20")}>{icon}{l}</Button>)}</div>
  );
  const Row = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
    <div className="grid gap-3 border-b py-5 last:border-0 lg:grid-cols-[180px_minmax(0,1fr)] lg:items-center"><div><div className="text-sm font-medium">{label}</div>{hint && <div className="text-xs text-muted-foreground">{hint}</div>}</div><div>{children}</div></div>
  );

  return (
    <Shell
      title="Settings"
      subtitle="Preferences are saved on this device"
      actions={
        leadPilotAvailable ? (
          <Button
            type="button"
            variant="outline"
            className="rounded-lg gap-1.5"
            onClick={() => {
              setLeadPilotSessionOptIn(true);
              void navigate({ to: "/settings", search: (prev) => ({ ...prev, pilot: 1 }) });
            }}
          >
            <Database className="size-4" />
            Dev Settings Pilot
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto xl:flex-col">
          {SECTIONS.map((x) => <Button variant="ghost" key={x.id} onClick={() => setSec(x.id)} className={cn("flex shrink-0 justify-start items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors", sec === x.id ? "bg-card font-medium text-foreground shadow-card" : "text-muted-foreground hover:text-foreground")}><x.icon className="size-4" />{x.label}</Button>)}
        </nav>
        <section className="settings-content surface p-5 sm:p-6">
          <h2 className="mb-2 text-lg font-semibold">{SECTIONS.find((x) => x.id === sec)?.label}</h2>
          {sec === "profile" && <>
            <div className="flex items-center gap-4 py-3"><div className="grid size-14 place-items-center rounded-full bg-primary text-lg font-bold text-primary-foreground">{initials(s.owner)}</div><div><div className="font-semibold">{s.owner}</div><div className="text-sm text-muted-foreground">{s.email} · Owner</div></div></div>
            <Row label="Display name"><Input value={owner} onChange={(e) => setOwner(e.target.value)} /></Row>
            <Row label="Business name"><Input value={business} onChange={(e) => setBusiness(e.target.value)} /></Row>
            <Row label="Email" hint="Shown on your profile only"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Row>
            <div className="pt-4 text-right"><Button onClick={() => { if (!owner.trim()) { toast.error("Name required"); return; } p({ owner: owner.trim(), business: business.trim() || "Scale Flow", email }); }}>Save profile</Button></div>
          </>}
          {sec === "appearance" && <>
            <Row label="Theme"><Choice value={s.theme} onChange={(v) => p({ theme: v })} options={[["light", "Light", <Sun key="l" className="size-4" />], ["dark", "Dark", <Moon key="d" className="size-4" />], ["system", "System", <Monitor key="s" className="size-4" />]] as const} /></Row>
            <Row label="Accent colour"><div className="flex gap-2">{(["indigo", "emerald", "blue"] as const).map((a) => <Button size="icon" key={a} title={a} aria-label={a} onClick={() => p({ accent: a })} data-swatch={a} className={cn("size-9 rounded-full border-4 border-card ring-2 transition", s.accent === a ? "ring-foreground" : "ring-transparent")} />)}</div></Row>
            <Row label="Density" hint="Compact shows more on screen"><Choice value={s.density} onChange={(v) => p({ density: v })} options={[["comfortable", "Comfortable"], ["compact", "Compact"]] as const} /></Row>
          </>}
          {sec === "datetime" && <>
            <Row label="Timezone" hint="All dates use this zone"><Input value={`${TIMEZONE} (IST, UTC+5:30)`} disabled /></Row>
            <Row label="Time format"><Choice value={s.timeFormat} onChange={(v) => p({ timeFormat: v })} options={[["12h", "12-hour"], ["24h", "24-hour"]] as const} /></Row>
            <Row label="Date style"><Choice value={s.dateStyle} onChange={(v) => p({ dateStyle: v })} options={[["short", "21 Oct"], ["long", "21 October 2026"]] as const} /></Row>
          </>}
          {sec === "crm" && <>
            <Row label="Default lead sort"><select className={selectCls} value={s.defaultLeadSort} onChange={(e) => p({ defaultLeadSort: e.target.value as Prefs["defaultLeadSort"] })}><option value="recent">Newest first</option><option value="score">Highest score</option><option value="value">Highest value</option></select></Row>
            <Row label="Currency"><Input value="Indian Rupee (₹)" disabled /></Row>
          </>}
          {sec === "notifications" && <>
            <p className="mb-2 text-sm text-muted-foreground">Choices are saved now. Delivery by email or push starts once the backend is connected. <Pending /></p>
            {([["notifyFollowUps", "Follow-up reminders", "Before each scheduled follow-up"], ["notifyPayments", "Payment alerts", "When a payment becomes overdue"], ["notifyDigest", "Morning digest", "Daily Briefing summary at 9 AM"]] as const).map(([k, l, h]) => (
              <Row key={k} label={l} hint={h}><Switch checked={s[k]} onCheckedChange={(v) => p({ [k]: v })} /></Row>
            ))}
          </>}
          {sec === "security" && <>
            <div className="mb-3 rounded-lg border bg-muted/40 p-3 text-sm">
              <div className="font-medium text-foreground">
                Authenticated Owner session: {authUser?.email ?? "Active Owner"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {idleExpiresAt ? `Idle timeout: ${formatDateTime(idleExpiresAt)}` : "HttpOnly server session active"}
                {expiresAt ? ` · Max expiry: ${formatDateTime(expiresAt)}` : ""}
              </div>
            </div>
            <Row
              label="Password"
              hint="Self-service password change arrives in a follow-up update. Emergency rotation runs via server CLI (--reset-password)."
            >
              <div className="grid gap-2 sm:max-w-sm">
                <Input type="password" placeholder="Current password" disabled />
                <Input type="password" placeholder="New password" disabled />
                <Button disabled>Update password</Button>
              </div>
            </Row>
            <Row label="Two-step verification" hint="Planned follow-up"><Switch disabled /></Row>
            <Row label="Sessions" hint="Sign out this browser or revoke every active Owner session on the server">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={sessionBusy !== null}
                  onClick={() => {
                    setSessionBusy("logout");
                    void logoutOwner({ allSessions: false });
                  }}
                >
                  {sessionBusy === "logout" ? "Signing out…" : "Log out"}
                </Button>
                <Button
                  variant="destructive"
                  disabled={sessionBusy !== null}
                  onClick={() => {
                    setSessionBusy("logout-all");
                    void logoutOwner({ allSessions: true });
                  }}
                >
                  {sessionBusy === "logout-all" ? "Revoking sessions…" : "Log out all sessions"}
                </Button>
              </div>
            </Row>
          </>}
          {sec === "data" && <>
            {!pv && <StorageDiagnostic />}
            <Row label="Backups & export" hint="Owner only · full, custom and employee backups with payment proof files live in Data Vault"><Button asChild variant="outline"><Link to="/data-vault"><Download className="size-4" />Open Data Vault</Link></Button></Row>
            <Row label="Reset demo data" hint="Restores the original sample leads, deals and notes. Preferences are kept."><Button variant="destructive" onClick={() => { if (window.confirm("Reset all demo data?")) { s.reset(); toast.success("Demo data restored"); } }}>Reset demo data</Button></Row>
          </>}
        </section>
      </div>
    </Shell>
  );
}
