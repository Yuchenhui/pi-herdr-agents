import {
	buildTaskModelBrief,
	buildTaskModelInitPrompt,
	type TaskModelRegistryProjector,
	type TaskModelRegistrySnapshot,
} from "../core/config/task-model-init.ts";
import type { ModelConfig } from "../core/config/model-config.ts";
import { projectTaskModelRegistry } from "../adapters/pi/task-model-init.ts";

/** Compose the active Pi projection with current saved choices and the complete init prompt. */
export function initializeTaskModels(input: {
	/** The host supplies its actual active registry to this projector exactly once. */
	projectActiveRegistry(
		project: TaskModelRegistryProjector,
	): TaskModelRegistrySnapshot;
	current: ModelConfig;
	preferences: string;
}): string {
	const snapshot = input.projectActiveRegistry(projectTaskModelRegistry);
	const brief = buildTaskModelBrief(snapshot, input.current, input.preferences);
	return buildTaskModelInitPrompt(brief);
}
