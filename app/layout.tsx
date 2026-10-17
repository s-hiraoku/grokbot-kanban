import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_JP } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { THEME_SCRIPT } from "@/lib/theme-script";
import "./globals.css";

// Body text is mostly Japanese reports, so the board reads in IBM Plex Sans JP, a crisp face that stays
// legible small. next/font serves it from the app itself, split by character range, so a page only
// downloads the glyphs it shows.
const sans = IBM_Plex_Sans_JP({ weight: ["400", "500", "700"], display: "swap", preload: false, variable: "--font-plex-sans-jp" });

export const metadata: Metadata = {
	title: "Grok Bot Kanban",
	description: "Kanban for Grok Bot studio agents",
};

export const viewport: Viewport = {
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#e7ebf4" },
		{ media: "(prefers-color-scheme: dark)", color: "#161c36" },
	],
	colorScheme: "light dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		// The theme script sets the dark class before React hydrates, so the class on <html> differs from the server's.
		<html lang="ja" className={sans.variable} suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
			</head>
			<body>
				<TooltipProvider delayDuration={400}>{children}</TooltipProvider>
			</body>
		</html>
	);
}
