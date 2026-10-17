"use client";

import { CheckIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { Menu, MenuItem, MenuTitle } from "@/components/ActionMenu";
import { Button } from "@/components/ui/button";
import { setTheme, useTheme, type ThemeChoice } from "@/lib/theme";

const CHOICES: { value: ThemeChoice; label: string; icon: typeof SunIcon }[] = [
	{ value: "light", label: "Light", icon: SunIcon },
	{ value: "dark", label: "Dark", icon: MoonIcon },
	{ value: "system", label: "System", icon: MonitorIcon },
];

/** Light, Dark, or follow the OS. The choice is kept in this browser. */
export function ThemeMenu() {
	const { choice, dark } = useTheme();
	const Current = dark ? MoonIcon : SunIcon;
	return (
		<Menu
			trigger={
				<Button variant="ghost" size="icon" aria-label={`Theme: ${CHOICES.find((item) => item.value === choice)?.label}`} title="Theme">
					<Current />
				</Button>
			}
		>
			<MenuTitle>Theme</MenuTitle>
			{CHOICES.map(({ value, label, icon: Icon }) => (
				<MenuItem key={value} current={value === choice} aria-checked={value === choice} role="menuitemradio" onSelect={() => setTheme(value)}>
					<Icon />
					{label}
					{value === choice ? <CheckIcon className="ml-auto" /> : null}
				</MenuItem>
			))}
		</Menu>
	);
}
