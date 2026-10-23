import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Bell, CheckCheck, Settings2, ArrowUpRight, AlertTriangle } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useCRM } from "@/lib/crm/store";
import { deriveNotifications, isRead, notificationLink, unreadCount, type Notification } from "@/lib/crm/activity";
import { dayKey } from "@/lib/crm/dates";
import { formatDateTime } from "@/lib/crm/format";
import { NotificationSettingsDialog } from "./NotificationSettings";
import { cn } from "@/lib/utils";

/** Owner notification bell + drawer. Rendered once in Shell. Notifications are local only — nothing is delivered remotely. */
export function NotificationCenter() {
  const events = useCRM((s) => s.teamEvents);
  const followUps = useCRM((s) => s.followUps);
  const leads = useCRM((s) => s.leads);
  const prefs = useCRM((s) => s.notifyPrefs);
  const reads = useCRM((s) => s.notifyReads);
  const markOne = useCRM((s) => s.markNotificationRead);
  const markAll = useCRM((s) => s.markAllNotificationsRead);
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const navigate = useNavigate();
  const list = useMemo(() => deriveNotifications(events, followUps, leads, prefs, new Date()), [events, followUps, leads, prefs]);
  const unread = unreadCount(list, reads);
  const today = dayKey(new Date());
  const fresh = list.filter((n) => dayKey(n.at) === today || !isRead(n, reads));
  const earlier = list.filter((n) => !fresh.includes(n));
  const go = (n: Notification) => { markOne(n.id); setOpen(false); void navigate(notificationLink(n) as never); };
  const Row = ({ n }: { n: Notification }) => {
    const read = isRead(n, reads);
    return <li className={cn("nc-item", !read && "nc-unread")} data-importance={n.importance}>
      <button type="button" className="nc-main" onClick={() => go(n)}>
        <span className="nc-dot" aria-hidden />
        <span className="min-w-0 flex-1 text-left">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold">{n.importance === "high" && <AlertTriangle className="size-3.5 text-warning" aria-label="Important" />}{n.title}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{n.body}</span>
          <span className="mt-1 block text-[11px] text-muted-foreground num">{formatDateTime(n.at)}</span>
        </span>
        <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {!read && <button type="button" className="nc-mark" onClick={() => markOne(n.id)} aria-label={`Mark "${n.title}" as read`}>Mark read</button>}
    </li>;
  };
  return <>
    <button type="button" title="Notifications" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} onClick={() => setOpen(true)} className="topbar-icon relative">
      <Bell className="size-[18px]" />
      {unread > 0 && <span className="nc-badge num">{unread > 99 ? "99+" : unread}</span>}
    </button>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b p-5 pr-12">
          <SheetTitle>Notifications</SheetTitle>
          <SheetDescription>From records saved in this browser · not delivered to other devices</SheetDescription>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={markAll} disabled={!unread}><CheckCheck />Mark all as read</Button>
            <Button size="sm" variant="ghost" onClick={() => setSettings(true)}><Settings2 />Settings</Button>
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {!list.length && <div className="px-6 py-14 text-center"><Bell className="mx-auto size-6 text-muted-foreground" /><p className="mt-3 editorial text-xl">All caught up</p><p className="mt-1 text-xs text-muted-foreground">New activity you've chosen to follow appears here.</p></div>}
          {fresh.length > 0 && <><h3 className="eyebrow px-2 pt-2 pb-1">New</h3><ul className="grid gap-1">{fresh.map((n) => <Row key={n.id} n={n} />)}</ul></>}
          {earlier.length > 0 && <><h3 className="eyebrow px-2 pt-4 pb-1">Earlier</h3><ul className="grid gap-1">{earlier.map((n) => <Row key={n.id} n={n} />)}</ul></>}
        </div>
        <div className="border-t p-3"><Button asChild variant="outline" className="w-full"><Link to="/team-activity" onClick={() => setOpen(false)}>View all activity</Link></Button></div>
      </SheetContent>
    </Sheet>
    <NotificationSettingsDialog open={settings} onOpenChange={setSettings} />
  </>;
}
