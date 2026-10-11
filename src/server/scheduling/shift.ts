/**
 * Shift tasks that collide with an approved leave to the next available slot (SPEC §9.3).
 * Implemented in ./slot.ts; this module is the stable entry point other modules import.
 */
export { shiftTasksForLeave, tasksAffectedByLeave } from "@/server/scheduling/slot";
