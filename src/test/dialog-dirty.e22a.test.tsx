import { describe, expect, it } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

function Harness() {
  const [open, setOpen] = useState(true);
  const [v, setV] = useState("");
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent dirty={!!v}><DialogTitle>Draft form</DialogTitle><DialogDescription>d</DialogDescription><input aria-label="Field" value={v} onChange={(e) => setV(e.target.value)} /></DialogContent>
  </Dialog>;
}
const esc = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

describe("E2.2A unsaved-draft guard", () => {
  it("closes immediately on Escape when nothing was typed", async () => {
    render(<Harness />);
    await screen.findByRole("dialog");
    esc();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("asks before discarding a typed draft; Keep editing keeps the text, Discard closes", async () => {
    render(<Harness />);
    fireEvent.change(await screen.findByLabelText("Field"), { target: { value: "half-written" } });
    esc();
    expect(await screen.findByText("Discard unsaved changes?")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
    expect((screen.getByLabelText("Field") as HTMLInputElement).value).toBe("half-written");
    esc();
    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
