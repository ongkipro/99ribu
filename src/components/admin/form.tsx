"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";

// S113: shared form patterns of the admin console (shadcn Field + Dialog). A field is a
// labelled control with an optional hint; a form dialog is the confirm/edit dialog every money
// or audit action uses (Batal + submit, pending lock, one alert line for the refusal).

/** Native select styled like the shadcn Input (keeps native keyboard and mobile pickers). */
export const nativeSelectClass =
	"h-9 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function FormField({
	id,
	label,
	hint,
	children,
}: {
	/** id of the control inside `children`; the label points at it. */
	id: string;
	label: ReactNode;
	/** Shown under the control; give the control aria-describedby={`${id}-hint`}. */
	hint?: ReactNode;
	children: ReactNode;
}) {
	return (
		<Field className="gap-1.5">
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			{children}
			{hint && (
				<FieldDescription id={`${id}-hint`} className="text-xs">
					{hint}
				</FieldDescription>
			)}
		</Field>
	);
}

/** A small set of mutually exclusive filters as pressed toggle buttons. */
export function SegmentedControl<K extends string>({
	legend,
	value,
	options,
	onChange,
}: {
	legend: string;
	value: K;
	options: readonly (readonly [K, string])[];
	onChange: (value: K) => void;
}) {
	return (
		<fieldset className="inline-flex w-fit max-w-full flex-wrap gap-1 rounded-lg border bg-muted p-1">
			<legend className="sr-only">{legend}</legend>
			{options.map(([key, label]) => (
				<button
					key={key}
					type="button"
					aria-pressed={value === key}
					className={`min-h-9 rounded-md px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${value === key ? "bg-background shadow-sm" : "text-muted-foreground"}`}
					onClick={() => onChange(key)}
				>
					{label}
				</button>
			))}
		</fieldset>
	);
}

export function FormDialog({
	title,
	description,
	pending,
	error,
	submitLabel,
	pendingLabel = "Menyimpan…",
	onClose,
	onSubmit,
	children,
}: {
	title: ReactNode;
	description?: ReactNode;
	pending: boolean;
	error: string | null;
	submitLabel: string;
	pendingLabel?: string;
	onClose: () => void;
	onSubmit: () => void;
	children: ReactNode;
}) {
	return (
		<Dialog
			open
			onOpenChange={(next) => {
				if (!next && !pending) onClose();
			}}
		>
			<DialogContent {...(description ? {} : { "aria-describedby": undefined })}>
				<form
					noValidate
					className="flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (!pending) onSubmit();
					}}
				>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						{description && <DialogDescription>{description}</DialogDescription>}
					</DialogHeader>
					{children}
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button type="button" variant="outline" disabled={pending} onClick={onClose}>
							Batal
						</Button>
						<Button type="submit" disabled={pending}>
							{pending ? pendingLabel : submitLabel}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
