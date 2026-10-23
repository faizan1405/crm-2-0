import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { useCRM } from "@/lib/crm/store";
import { startPreview, exitPreview } from "@/lib/crm/preview";
import { useSession } from "@/lib/crm/session";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/team_/preview/$id")({
  head: () => ({
    meta: [
      { title: "Employee Workspace Preview · Scale Flow Sales OS" },
      { name: "description", content: "Demo preview of an employee's working CRM on a temporary copy of their records." },
      { property: "og:title", content: "Employee Workspace Preview · Scale Flow Sales OS" },
      { property: "og:description", content: "Demo preview of an employee's working CRM on a temporary copy of their records." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Preview,
});

// Starts an isolated preview session, then opens the employee's real Dashboard.
function Preview() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      if (!useSession.getState().preview) await useCRM.persist.rehydrate();
      else exitPreview();
      if (!live) return;
      const e = useCRM.getState().employees.find((x) => x.id === id && x.accountStatus !== "archived");
      if (!e) { setMissing(true); return; }
      startPreview(e);
      void navigate({ to: "/", replace: true });
    })();
    return () => { live = false; };
  }, [id, navigate]);
  if (missing) return <div className="grid min-h-screen place-items-center p-6 text-center"><div><Users className="mx-auto size-6 text-muted-foreground" /><p className="mt-3 text-lg font-semibold">Employee not found</p><Button asChild className="mt-4"><Link to="/team">Back to Team</Link></Button></div></div>;
  return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Opening employee workspace…</div>;
}
