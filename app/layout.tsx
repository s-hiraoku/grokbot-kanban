import type { Metadata, Viewport } from "next";
import { Chakra_Petch, Noto_Sans_JP } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// Body text is mostly Japanese, so the board reads in Noto Sans JP. next/font serves it from the app itself,
// split by character range, so a page only downloads the glyphs it shows.
const sans = Noto_Sans_JP({ weight: ["400", "500", "700"], display: "swap", preload: false, variable: "--font-noto-sans-jp" });
// Short English labels: the wordmark, column names, counts.
const display = Chakra_Petch({ weight: ["500", "600", "700"], subsets: ["latin"], display: "swap", variable: "--font-chakra-petch" });

export const metadata: Metadata = {
	title: "Grok Bot Kanban",
	description: "Kanban for Grok Bot studio agents",
};

export const viewport: Viewport = {
	themeColor: "#161c36",
	colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="ja" className={`dark ${sans.variable} ${display.variable}`}>
			<body>
				<TooltipProvider delayDuration={400}>{children}</TooltipProvider>
			</body>
		</html>
	);
}
