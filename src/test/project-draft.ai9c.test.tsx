import { useState } from "react";
import { createBrowserHistory, createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider, useRouter } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectDraftGuard } from "@/components/projects/ProjectDraftGuard";

afterEach(cleanup);

function setup(browserHistory = false) {
  const record = { name: "Synthetic Project", saves: 0 };
  function Editor() {
    const router = useRouter();
    const [draft, setDraft] = useState(record.name);
    const [base, setBase] = useState(record.name);
    const dirty = draft !== base;
    return <><ProjectDraftGuard dirty={dirty} />
      <input aria-label="Project name" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button onClick={() => router.navigate({ to: "/notes" })}>Leave</button>
      <button disabled={!dirty} onClick={() => { if (!dirty) return; record.name = draft; record.saves++; setBase(draft); }}>Save</button>
    </>;
  }
  const root = createRootRoute({ component: Outlet });
  const editor = createRoute({ getParentRoute: () => root, path: "/projects", component: Editor });
  const away = createRoute({ getParentRoute: () => root, path: "/notes", component: () => <div>Notes page</div> });
  if (browserHistory) { window.history.replaceState({ __TSR_index: 0, __TSR_key: "notes" }, "", "/notes"); window.history.pushState({ __TSR_index: 1, __TSR_key: "project" }, "", "/projects"); }
  const history = browserHistory ? createBrowserHistory() : createMemoryHistory({ initialEntries: ["/notes", "/projects"] });
  const router = createRouter({ routeTree: root.addChildren([editor, away]), history });
  render(<RouterProvider router={router} />);
  return { record, router, history };
}

describe("AI-9C Project explicit-save navigation protection", () => {
  it("Keep editing preserves exact typed text and writes nothing", async () => {
    const { record, router } = setup();
    fireEvent.change(await screen.findByLabelText("Project name"), { target: { value: "Draft ‘A’\nexact" } });
    const exact = (screen.getByLabelText("Project name") as HTMLInputElement).value;
    fireEvent.click(screen.getByText("Leave"));
    fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(router.state.location.pathname).toBe("/projects");
    expect((screen.getByLabelText("Project name") as HTMLInputElement).value).toBe(exact);
    expect(record).toEqual({ name: "Synthetic Project", saves: 0 });
  });
  it("Discard completes navigation without changing saved records", async () => {
    const { record, router } = setup();
    fireEvent.change(await screen.findByLabelText("Project name"), { target: { value: "Discard me" } });
    fireEvent.click(screen.getByText("Leave"));
    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/notes"));
    expect(record).toEqual({ name: "Synthetic Project", saves: 0 });
    await act(() => router.navigate({ to: "/projects" }));
    expect((await screen.findByLabelText("Project name") as HTMLInputElement).value).toBe("Synthetic Project");
  });
  it("an unchanged or reverted draft leaves immediately", async () => {
    const { router, record } = setup();
    const field = await screen.findByLabelText("Project name");
    fireEvent.change(field, { target: { value: "Temporary" } });
    fireEvent.change(field, { target: { value: "Synthetic Project" } });
    fireEvent.click(screen.getByText("Leave"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/notes"));
    expect(record.saves).toBe(0);
  });
  it("explicit save writes once, clears protection and survives remount", async () => {
    const { record, router } = setup();
    fireEvent.change(await screen.findByLabelText("Project name"), { target: { value: "Saved Project" } });
    fireEvent.click(screen.getByText("Save"));
    fireEvent.click(screen.getByText("Save"));
    fireEvent.click(screen.getByText("Leave"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/notes"));
    await act(() => router.navigate({ to: "/projects" }));
    expect((await screen.findByLabelText("Project name") as HTMLInputElement).value).toBe("Saved Project");
    expect(record.saves).toBe(1);
  });
  it("Back can be cancelled without losing the draft, then explicitly discarded", async () => {
    const { router, history, record } = setup(true);
    fireEvent.change(await screen.findByLabelText("Project name"), { target: { value: "Back draft" } });
    history.back();
    fireEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.state.location.pathname).toBe("/projects");
    expect((screen.getByLabelText("Project name") as HTMLInputElement).value).toBe("Back draft");
    history.back();
    fireEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/notes"));
    expect(record.saves).toBe(0);
    cleanup();
    history.destroy();
  });
});