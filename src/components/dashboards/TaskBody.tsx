"use client";
import type { TaskDash } from "@/server/dashboards/tasks";
import { PERIOD_LABEL } from "@/server/dashboards/params";
import { BarList, Card, Empty, StateBar, Tile, Tiles } from "@/components/dashboards/charts";
import { useDash } from "@/components/dashboards/DashboardsScreen";
import { hrs } from "@/components/dashboards/format";

/** Tasks view (prototype `taskBody`): open tasks by row colour, completed / on time in the period, open hours. */
export function TaskBody({ data: d }: { data: TaskDash }) {
  const { params, go } = useDash();
  const n = (k: string) => d.byState.find((s) => s.key === k)?.count ?? 0;
  return (
    <>
      <Tiles>
        <Tile label="Open tasks" value={String(d.open)} sub={`${hrs(d.openMinutes)} booked`} />
        <Tile label="Late to start" value={String(n("red"))} alert={n("red") > 0} sub={n("red") > 0 ? "start now" : null} />
        <Tile label="Paused" value={String(n("yellow"))} />
        <Tile label="Doubts" value={String(n("purple"))} />
        <Tile label="Completed" value={String(d.completed)} sub={PERIOD_LABEL[params.period].toLowerCase()} />
        <Tile label="On time" value={d.onTimePct === null ? "—" : `${d.onTimePct}%`} sub="of completed" />
      </Tiles>
      <Card title="Open tasks by state">
        <StateBar segments={d.byState} />
      </Card>
      <Card title="Open hours by team">
        {d.byTeam.length ? <BarList rows={d.byTeam} fmt={hrs} onPick={(id) => go({ team: params.team === id ? null : id })} activeId={params.team} /> : <Empty>No open tasks</Empty>}
      </Card>
      <Card title="Open hours by client">
        {d.byClient.length ? <BarList rows={d.byClient} fmt={hrs} onPick={(id) => go({ client: params.client === id ? null : id })} activeId={params.client} /> : <Empty>No open tasks</Empty>}
      </Card>
    </>
  );
}
