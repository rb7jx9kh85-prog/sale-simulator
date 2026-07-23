import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alpinia Sales Simulator",
  description: "Entraînement au cold call avec des prospects suisses réalistes.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
