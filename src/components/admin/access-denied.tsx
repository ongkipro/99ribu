import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Server-rendered notice for a console page the current role cannot use. */
export function AccessDenied({
	title,
	heading,
	children,
}: {
	title: string;
	heading: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-6 px-4 py-5 md:px-8 md:py-6">
			<header className="border-b pb-5">
				<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
			</header>
			<section
				aria-labelledby="access-denied-heading"
				className="flex max-w-2xl flex-col gap-3 rounded-lg border border-warning/40 bg-warning-surface p-5"
			>
				<div className="flex items-center gap-2">
					<ShieldAlert aria-hidden="true" className="size-5 text-warning" />
					<h2 id="access-denied-heading" className="text-base font-semibold">
						{heading}
					</h2>
				</div>
				<p className="text-sm leading-relaxed">{children}</p>
				<Button asChild className="self-start">
					<a href="/admin">Ke Konsol Operasional</a>
				</Button>
			</section>
		</div>
	);
}
