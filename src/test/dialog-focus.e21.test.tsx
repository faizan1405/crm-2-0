import { describe, expect, it } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

function Harness() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open form</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent><DialogTitle>Test form</DialogTitle><DialogDescription>d</DialogDescription><input aria-label="Field" autoFocus /></DialogContent>
    </Dialog>
  </>;
}

describe("E2.1 dialog focus management", () => {
  it("opens by keyboard-activated button, names the dialog, and returns focus to the opener on Escape", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open form" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Test form" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
