"use client";

import { cn } from "cn";
import { SlidersHorizontal } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/components/ui/use-mobile";

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
	invalid = false,
	className,
	children,
}: {
	/** e.g. "w-auto" for an inline filter row; fields are full width by default. */
	className?: string;
	/** The hint is an error: label and hint turn destructive (the control still sets aria-invalid). */
	invalid?: boolean;
	/** id of the control inside `children`; the label points at it. */
	id: string;
	label: ReactNode;
	/** Shown under the control; give the control aria-describedby={`${id}-hint`}. */
	hint?: ReactNode;
	children: ReactNode;
}) {
	return (
		<Field className={cn("gap-1.5", className)} data-invalid={invalid || undefined}>
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

/**
 * The one tab/filter control look of the console (segmented pills); tablists reuse it. Phones
 * keep one row of chips that scrolls sideways inside itself instead of wrapping into a toolbar.
 */
export const segmentedListClass =
	"inline-flex w-fit max-w-full min-w-0 flex-wrap gap-1 rounded-lg border bg-muted p-1 max-md:flex-nowrap max-md:overflow-x-auto max-md:overscroll-x-contain max-md:[scrollbar-width:none]";
export const segmentedItemClass = (active: boolean) =>
	cn(
		"min-h-9 shrink-0 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11",
		active
			? "bg-background text-foreground shadow-sm"
			: "text-muted-foreground hover:text-foreground",
	);

/** A small set of mutually exclusive filters as pressed toggle buttons. */
export function SegmentedControl<K extends string>({
	legend,
	value,
	options,
	onChange,
	testId,
}: {
	legend: string;
	value: K;
	options: readonly (readonly [K, string])[];
	onChange: (value: K) => void;
	testId?: (key: K) => string;
}) {
	// Phones scroll the chip row sideways: keep the active chip fully in view.
	const listRef = useRef<HTMLFieldSetElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the active chip changes
	useEffect(() => {
		const list = listRef.current;
		const item = list?.querySelector<HTMLElement>('[aria-pressed="true"]');
		if (!list || !item || list.scrollWidth <= list.clientWidth) return;
		const box = list.getBoundingClientRect();
		const at = item.getBoundingClientRect();
		if (at.right > box.right) list.scrollLeft += at.right - box.right + 8;
		else if (at.left < box.left) list.scrollLeft -= box.left - at.left + 8;
	}, [value]);
	return (
		<fieldset ref={listRef} className={segmentedListClass}>
			<legend className="sr-only">{legend}</legend>
			{options.map(([key, label]) => (
				<button
					key={key}
					type="button"
					aria-pressed={value === key}
					data-testid={testId?.(key)}
					className={segmentedItemClass(value === key)}
					onClick={() => onChange(key)}
				>
					{label}
				</button>
			))}
		</fieldset>
	);
}

/**
 * The one filter pattern for screens with several filter fields: inline from md (the caller's
 * grid lays them out), and on phones one "Filter" button with the active count that opens a
 * bottom sheet holding the same fields (focus trapped, focus returns to the button). Filters
 * apply as they change; "Tampilkan hasil" only closes the sheet.
 */
export function FilterSheet({
	active,
	children,
}: {
	active: number;
	children: ReactNode;
}) {
	const isMobile = useIsMobile();
	const [open, setOpen] = useState(false);
	if (!isMobile) return <>{children}</>;
	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetTrigger asChild>
				<Button type="button" variant="outline" className="justify-self-start">
					<SlidersHorizontal data-icon="inline-start" aria-hidden="true" />
					Filter
					{active > 0 && (
						<Badge variant="secondary" className="tabular-nums">
							{active}
							<span className="sr-only"> aktif</span>
						</Badge>
					)}
				</Button>
			</SheetTrigger>
			<SheetContent
				side="bottom"
				className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-xl"
			>
				<SheetHeader>
					<SheetTitle>Filter</SheetTitle>
					<SheetDescription>
						Daftar langsung diperbarui setiap filter berubah.
					</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-4 px-4 pb-4">{children}</div>
				<SheetFooter className="sticky bottom-0 border-t bg-popover pb-[max(1rem,env(safe-area-inset-bottom))]">
					<SheetClose asChild>
						<Button type="button">Tampilkan hasil</Button>
					</SheetClose>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

/**
 * Id of the open FormDialog's error line while it shows, else undefined. A field inside the dialog
 * adds it to its aria-describedby so the refusal is read with the control it concerns.
 */
const FormDialogErrorContext = createContext<string | undefined>(undefined);
export const useFormDialogErrorId = () => useContext(FormDialogErrorContext);

export function FormDialog({
	title,
	description,
	pending,
	error,
	submitLabel,
	pendingLabel = "Menyimpan…",
	onClose,
	onSubmit,
	className,
	dirty = false,
	destructive = false,
	children,
}: {
	title: ReactNode;
	description?: ReactNode;
	/** Wider or taller dialogs (a form beside its preview); applied to DialogContent. */
	className?: string;
	pending: boolean;
	error: string | null;
	submitLabel: string;
	pendingLabel?: string;
	onClose: () => void;
	onSubmit: () => void;
	/**
	 * Unsaved input: Esc, the overlay, the close button and Batal first ask "Buang perubahan?"
	 * ("Lanjut mengedit" focused, "Buang" closes). Off: they close at once, as before.
	 */
	dirty?: boolean;
	/** The submit is a destructive action: destructive button; focus never starts on it. */
	destructive?: boolean;
	children: ReactNode;
}) {
	const errorId = useId();
	const [confirming, setConfirming] = useState(false);
	const keepRef = useRef<HTMLButtonElement>(null);
	const requestClose = () => {
		if (pending) return;
		if (dirty) setConfirming(true);
		else onClose();
	};
	return (
		<Dialog
			open
			onOpenChange={(next) => {
				if (!next) requestClose();
			}}
		>
			<DialogContent
				className={cn("md:max-h-[90dvh] md:overflow-y-auto", className)}
				{...(description ? {} : { "aria-describedby": undefined })}
			>
				<form
					noValidate
					className="flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (!pending) onSubmit();
					}}
				>
					<DialogHeader>
						{/* DialogTitle keeps clear of the corner close button and wraps long names. */}
						<DialogTitle>{title}</DialogTitle>
						{description && (
							<DialogDescription>{description}</DialogDescription>
						)}
					</DialogHeader>
					<FormDialogErrorContext value={error ? errorId : undefined}>
						{children}
					</FormDialogErrorContext>
					{/* Inside the dialog, next to the entered values (they stay); role=alert announces it. */}
					{error && (
						<p id={errorId} role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
					{/* Batal comes first in the DOM, so a destructive submit never takes the first focus. */}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={pending}
							onClick={requestClose}
						>
							Batal
						</Button>
						<Button
							type="submit"
							variant={destructive ? "destructive" : "default"}
							disabled={pending}
						>
							{pending ? pendingLabel : submitLabel}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
			{/* Nested modal: Esc or the overlay here only closes the question, the form stays. */}
			<Dialog open={confirming} onOpenChange={setConfirming}>
				<DialogContent
					role="alertdialog"
					showCloseButton={false}
					className="sm:max-w-sm"
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						keepRef.current?.focus();
					}}
				>
					<DialogHeader>
						<DialogTitle>Buang perubahan?</DialogTitle>
						<DialogDescription>
							Isian yang belum disimpan di formulir ini akan hilang.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							ref={keepRef}
							onClick={() => setConfirming(false)}
						>
							Lanjut mengedit
						</Button>
						<Button
							type="button"
							variant="destructive"
							onClick={() => {
								setConfirming(false);
								onClose();
							}}
						>
							Buang
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Dialog>
	);
}
