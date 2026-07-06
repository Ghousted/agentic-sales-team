import "./globals.css";
import type { Metadata } from "next";
import { AppProvider } from "@/lib/store";
import AppFrame from "@/components/AppFrame";
import { currentUser } from "@/lib/auth/actions";

export const metadata: Metadata = {
  title: "Agentic Salesforce",
  description: "The command center for your AI sales workforce.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser(); // server-verified session → hydrates the client store
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        {/* eslint-disable-next-line @next/next/google-font-preconnect */}
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poetsen+One&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AppProvider initialUser={user}>
          <AppFrame>{children}</AppFrame>
        </AppProvider>
      </body>
    </html>
  );
}
