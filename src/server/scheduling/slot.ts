// placeholder — replaced by the full implementation in this build
export async function tasksAffectedByLeave(_leaveId: string): Promise<{ id: string; title: string }[]> {
  return [];
}
export async function shiftTasksForLeave(_leaveId: string, _actorId: string): Promise<{ shifted: number }> {
  return { shifted: 0 };
}
