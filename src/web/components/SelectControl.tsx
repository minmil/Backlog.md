import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "className"> & {
	minWidthClass?: string;
	className?: string;
	fieldLabel?: string;
};

export const SELECT_TRIGGER_CLASS = "h-10 appearance-none rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-10 text-left text-sm text-gray-900 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-stone-500 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:ring-stone-400";
export const SELECT_MENU_CLASS = "z-50 max-h-64 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl ring-1 ring-black/5 dark:border-gray-600 dark:bg-gray-800 dark:ring-white/5";
export const SELECT_OPTION_CLASS = "w-full rounded-lg px-3 py-2 text-left text-sm text-gray-800 transition-colors hover:bg-blue-50 focus:bg-blue-50 focus:outline-none dark:text-gray-100 dark:hover:bg-gray-700 dark:focus:bg-gray-700";

export function SelectChevron(): React.ReactElement {
	return <svg aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-500 dark:text-gray-400" viewBox="0 0 12 12" fill="none"><path d="m2 4 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** Shared select treatment, including a styled option panel. The hidden select keeps form and keyboard integrations working. */
export default function SelectControl({ minWidthClass = "min-w-[140px]", className = "", fieldLabel, children, value, onChange, disabled, id, ...props }: Props): React.ReactElement {
	const [open, setOpen] = useState(false);
	const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const menuId = useId();
	const options = React.Children.toArray(children).filter((child): child is React.ReactElement<React.OptionHTMLAttributes<HTMLOptionElement>> => React.isValidElement(child) && child.type === "option");
	const selected = options.find((option) => String(option.props.value ?? option.props.children) === String(value ?? ""));
	const label = props["aria-label"];

	useEffect(() => {
		if (!open) return;
		const position = () => {
			const rect = triggerRef.current?.getBoundingClientRect();
			if (!rect) return;
			const below = window.innerHeight - rect.bottom >= 270 || rect.top < 270;
			const width = Math.min(Math.max(rect.width, 180), window.innerWidth - 16);
			setMenuStyle({ position: "fixed", left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: below ? rect.bottom + 6 : undefined, bottom: below ? undefined : window.innerHeight - rect.top + 6, width });
		};
		const closeOutside = (event: MouseEvent) => {
			const target = event.target as Node;
			if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
		};
		position();
		window.addEventListener("resize", position);
		window.addEventListener("scroll", position, true);
		document.addEventListener("mousedown", closeOutside);
		return () => { window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); document.removeEventListener("mousedown", closeOutside); };
	}, [open]);

	const choose = (next: string) => {
		onChange?.({ target: { value: next } } as React.ChangeEvent<HTMLSelectElement>);
		setOpen(false);
		triggerRef.current?.focus();
	};
	const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
		if (event.key === "Escape") { setOpen(false); return; }
		if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpen((current) => !current); return; }
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			if (!open) { setOpen(true); return; }
			const current = options.findIndex((option) => String(option.props.value ?? option.props.children) === String(value ?? ""));
			const next = (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
			if (options[next]) choose(String(options[next].props.value ?? options[next].props.children));
		}
	};

	return <span className={`relative inline-flex ${className}`}>
		<select id={id} {...props} value={value} onChange={onChange} disabled={disabled} tabIndex={-1} aria-hidden="true" className="pointer-events-none absolute h-px w-px opacity-0" onFocus={() => { triggerRef.current?.focus(); setOpen(true); }}>{children}</select>
		<button ref={triggerRef} type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-invalid={props["aria-invalid"]} aria-describedby={props["aria-describedby"]} disabled={disabled} onClick={() => setOpen((current) => !current)} onKeyDown={onKeyDown} className={`${minWidthClass} ${SELECT_TRIGGER_CLASS}`}>
			<span className="block truncate">{fieldLabel ? <strong className="mr-2 font-medium">{fieldLabel}</strong> : null}{selected?.props.children ?? ""}</span>
		</button>
		<SelectChevron />
		{open && createPortal(<div id={menuId} ref={menuRef} role="listbox" aria-label={label} className={SELECT_MENU_CLASS} style={menuStyle}>
			{options.map((option, index) => {
				const optionValue = String(option.props.value ?? option.props.children);
				return <button key={`${optionValue}-${index}`} type="button" role="option" data-value={optionValue} aria-selected={optionValue === String(value ?? "")} disabled={option.props.disabled} className={`${SELECT_OPTION_CLASS} ${optionValue === String(value ?? "") ? "bg-blue-50 font-medium text-blue-700 dark:bg-gray-700 dark:text-blue-300" : ""}`} onClick={() => choose(optionValue)}>{option.props.children}</button>;
			})}
		</div>, document.body)}
	</span>;
}
