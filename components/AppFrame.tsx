"use client";
// Auth gate: show the login screen until authenticated, otherwise the app shell
// with the routed page inside it. Toast + create-team modal live at this level.
import { usePathname } from "next/navigation";
import { useApp } from "@/lib/store";
import Shell from "./Shell";
import Login from "./Login";
import Toast from "./Toast";
import TeamModal from "./TeamModal";

// Routes that render full-screen, bypassing the sidebar shell (e.g. the
// onboarding wizard, which is its own full-page takeover in the design).
const FULLSCREEN = ["/create"];

// Routes that render themselves even without a session (e.g. password reset,
// reached from an emailed/surfaced link before the user is logged in).
const PUBLIC = ["/reset"];

export default function AppFrame({ children }: { children: React.ReactNode }) {
  const { s } = useApp();
  const path = usePathname();
  if (!s.authed) {
    if (PUBLIC.includes(path)) {
      return (
        <>
          {children}
          <Toast />
        </>
      );
    }
    return (
      <>
        <Login />
        <Toast />
      </>
    );
  }
  if (FULLSCREEN.includes(path)) {
    return (
      <>
        {children}
        {s.showTeamModal && <TeamModal />}
        <Toast />
      </>
    );
  }
  return (
    <>
      <Shell>{children}</Shell>
      {s.showTeamModal && <TeamModal />}
      <Toast />
    </>
  );
}
