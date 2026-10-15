import "./globals.css";
import type { Metadata } from "next";
import { AppProvider } from "@/lib/store";
import AppFrame from "@/components/AppFrame";
import { currentUser } from "@/lib/auth/actions";
import { loadWorkspace } from "@/lib/workspace/actions";

export const metadata: Metadata = {
  title: "Agentic Sales Team",
  description: "An AI sales team that works for you in chat.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser(); // server-verified session → hydrates the client store
  const workspace = user ? await loadWorkspace() : null; // persisted agents/teams/flags
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        {/* eslint-disable-next-line @next/next/google-font-preconnect */}
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        {/* General Sans (display face from the redesign) isn't on Google Fonts; Fontshare serves it. */}
        <link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <AppProvider initialUser={user} initialWorkspace={workspace}>
          <AppFrame>{children}</AppFrame>
        </AppProvider>
      </body>
    </html>
  );
}
