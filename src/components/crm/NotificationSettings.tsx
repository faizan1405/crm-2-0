import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useCRM } from "@/lib/crm/store";
import { NOTIFY_CATEGORIES } from "@/lib/crm/activity";

/** Owner notification categories. These never change employee permissions. */
export function NotificationSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const prefs = useCRM((s) => s.notifyPrefs);
  const setPrefs = useCRM((s) => s.setNotifyPrefs);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md">
    <DialogHeader><DialogTitle>Notification settings</DialogTitle><DialogDescription>Choose which activity reaches your bell. Activity is still recorded in Team Activity either way, and employee permissions are not affected.</DialogDescription></DialogHeader>
    <ul className="grid gap-1">{NOTIFY_CATEGORIES.map((c) => <li key={c.id}><label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg px-2 py-2.5 hover:bg-muted/60">
      <span><span className="block text-sm font-medium">{c.label}</span><span className="block text-xs text-muted-foreground">{c.desc}</span></span>
      <Switch checked={prefs[c.id]} onCheckedChange={(v) => setPrefs({ [c.id]: v })} aria-label={c.label} />
    </label></li>)}</ul>
  </DialogContent></Dialog>;
}
