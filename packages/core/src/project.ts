import { z } from "zod";

/**
 * A Project groups Shows and Hotcards for an ongoing event series
 * (e.g. "Sunday Services", "Christmas Eve"). Songs and Templates live
 * outside any project, in the org library, so they can be reused across
 * projects without duplication.
 */
export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  notes: z.string().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

/**
 * Slug assigned to existing Shows and Hotcards that pre-date the
 * Project concept. The server seeds a Project with this id on first boot
 * if no projects exist, so legacy data always has a real Project to land in.
 */
export const DEFAULT_PROJECT_ID = "default";
