import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { User, Palette, Clock, SlidersHorizontal, Bell, Shield, Database, Sun, Moon, Monitor, Download } from "lucide-react";
import { Shell, selectCls } from "@/components/crm/Shell";
import { useCRM, type Prefs } from "@/lib/crm/store";
import { TIMEZONE, initials } from "@/lib/crm/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

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
  component: Settings,
});

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
  const [sec, setSec] = useState<Sec>("profile");
  const [owner, setOwner] = useState(s.owner);
  const [business, setBusiness] = useState(s.business);
  const [email, setEmail] = useState(s.email);
  const p = (patch: Partial<Prefs>) => { s.preferences(patch); toast.success("Preference saved"); };
  const Choice = <T extends string>({ value, options, onChange }: { value: T; options: readonly (readonly [T, string, React.ReactNode?])[]; onChange: (v: T) => void }) => (
    <div className="flex flex-wrap gap-2">{options.map(([v, l, icon]) => <button key={v} onClick={() => onChange(v)} className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors", value === v ? "border-primary bg-primary-soft text-primary" : "hover:border-foreground/20")}>{icon}{l}</button>)}</div>
  );
  const Row = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
    <div className="grid gap-2 border-b py-4 last:border-0 lg:grid-cols-[180px_minmax(0,1fr)] lg:items-center"><div><div className="text-sm font-medium">{label}</div>{hint && <div className="text-xs text-muted-foreground">{hint}</div>}</div><div>{children}</div></div>
  );

  return (
    <Shell title="Settings" subtitle="Preferences are saved on this device">
      <div className="grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto xl:flex-col">
          {SECTIONS.map((x) => <button key={x.id} onClick={() => setSec(x.id)} className={cn("flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors", sec === x.id ? "bg-card font-medium text-foreground shadow-card" : "text-muted-foreground hover:text-foreground")}><x.icon className="size-4" />{x.label}</button>)}
        </nav>
        <section className="surface p-5 sm:p-6">
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
            <Row label="Accent colour"><div className="flex gap-2">{(["indigo", "emerald", "blue"] as const).map((a) => <button key={a} aria-label={a} onClick={() => p({ accent: a })} data-swatch={a} className={cn("size-9 rounded-full border-4 border-card ring-2 transition", s.accent === a ? "ring-foreground" : "ring-transparent")} />)}</div></Row>
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
            <p className="mb-2 text-sm text-muted-foreground">This demo has no sign-in yet, so nothing here changes a real account. <Pending /></p>
            <Row label="Password"><div className="grid gap-2 sm:max-w-sm"><Input type="password" placeholder="Current password" disabled /><Input type="password" placeholder="New password" disabled /><Button disabled>Update password</Button></div></Row>
            <Row label="Two-step verification"><Switch disabled /></Row>
            <Row label="Sessions"><Button variant="outline" onClick={() => toast.info("Sign-out will work once accounts are connected")}>Log out</Button></Row>
          </>}
          {sec === "data" && <>
            <Row label="Export" hint="Download all demo records as JSON"><Button variant="outline" onClick={() => {
              const { leads, deals, payments, followUps, notes, activities } = useCRM.getState();
              const url = URL.createObjectURL(new Blob([JSON.stringify({ leads, deals, payments, followUps, notes, activities }, null, 2)], { type: "application/json" }));
              const a = document.createElement("a"); a.href = url; a.download = "scale-flow-demo.json"; a.click(); URL.revokeObjectURL(url);
            }}><Download className="size-4" />Export JSON</Button></Row>
            <Row label="Reset demo data" hint="Restores the original sample leads, deals and notes. Preferences are kept."><Button variant="destructive" onClick={() => { if (window.confirm("Reset all demo data?")) { s.reset(); toast.success("Demo data restored"); } }}>Reset demo data</Button></Row>
          </>}
        </section>
      </div>
    </Shell>
  );
}
