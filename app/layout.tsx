import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../3rok-design-system/tokens.css";
import "../3rok-design-system/components/bundle.css";
import "./app.css";
import { AccountProvider } from "../components/AccountProvider";
import { AppNav } from "../components/ui/AppNav";

export const metadata: Metadata = {
  title: { default: "3ROK", template: "%s · 3ROK" },
  description:
    "3rok takes chip-test data, asks Grok for a flight algorithm that keeps those chips alive longer, and flies it on a globe.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body>
        <AccountProvider>
          <AppNav />
          {children}
        </AccountProvider>
      </body>
    </html>
  );
}
