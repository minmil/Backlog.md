import type { TaskSchema } from "../../schema/types.ts";

export function milestoneTerminology(schema: TaskSchema) {
	const singular = schema.fields.milestone?.label?.trim() || "Milestone";
	const plural = /[^aeiou]y$/i.test(singular)
		? `${singular.slice(0, -1)}ies`
		: /(?:s|x|z|ch|sh)$/i.test(singular)
			? `${singular}es`
			: `${singular}s`;
	return { singular, plural, singularLower: singular.toLowerCase(), pluralLower: plural.toLowerCase() };
}
