import "../styles/globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "x-ai talent engineer",
  description: "Find and analyze top AI researchers.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-bg text-accent font-brand antialiased">
        {children}
      </body>
    </html>
  );
}
