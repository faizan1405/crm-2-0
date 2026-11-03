import { useBlocker } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";

/** Only explicit-save Project fields participate; autosaved controls stay independent. */
export function ProjectDraftGuard({ dirty }: { dirty: boolean }) {
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });
  return <Dialog open={blocker.status === "blocked"} onOpenChange={(open) => { if (!open) blocker.reset?.(); }}>
    <DialogContent>
      <DialogTitle>Discard unsaved changes?</DialogTitle>
      <DialogDescription>Your Project edits haven't been saved. Discarding leaves the saved Project unchanged.</DialogDescription>
      <DialogFooter>
        <Button autoFocus onClick={() => blocker.reset?.()}>Keep editing</Button>
        <Button variant="outline" className="text-destructive" onClick={() => blocker.proceed?.()}>Discard changes</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}