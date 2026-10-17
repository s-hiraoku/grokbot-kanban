import type { Metadata, Viewport } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

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
		<html lang="en" className="dark">
			<head>
				<link rel="preconnect" href="https://fonts.googleapis.com" />
				<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
				<link
					href="https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&family=Chakra+Petch:wght@500;600;700&display=swap"
					rel="stylesheet"
				/>
			</head>
			<body>
				<TooltipProvider delayDuration={400}>{children}</TooltipProvider>
			</body>
		</html>
	);
}
