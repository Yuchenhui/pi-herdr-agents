export const TASK_CATEGORIES = [
	"coding",
	"review",
	"recon",
	"qa",
	"architecture",
	"docs",
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];
export const TASK_CATEGORY_DESCRIPTIONS = {
	coding: "Implementation workers",
	review: "Code reviewers",
	recon: "Reconnaissance scouts",
	qa: "Software and test runners",
	architecture: "Planning and diagnosis",
	docs: "Documentation workers",
} satisfies Record<TaskCategory, string>;
export type TaskPreferences = Partial<Record<TaskCategory, string[]>>;
export interface TaskPreferencesMeta {
	generatedAt: string;
	method: "research" | "registry-only";
}
