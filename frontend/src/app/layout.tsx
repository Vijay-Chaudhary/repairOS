import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: {
    default: "RepairOS",
    template: "%s | RepairOS",
  },
  description: "Mobile-first repair shop management platform",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "RepairOS",
  },
};

export const viewport: Viewport = {
  themeColor: "#1e40af",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased bg-gray-50">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
