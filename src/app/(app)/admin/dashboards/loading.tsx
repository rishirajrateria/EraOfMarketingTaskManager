/** First load of the Admin dashboards (ADR 0016): tile and card placeholders in the glass look. */
export default function DashboardsLoading() {
  const block = "animate-pulse rounded-[14px] border border-hair bg-glass";
  return (
    <div className="flex flex-1 flex-col gap-2.5 px-3 pt-3" aria-busy="true" aria-label="Loading dashboard">
      <div className="mx-1 h-3 w-40 animate-pulse rounded-full bg-chip" />
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`${block} h-[62px]`} />
        ))}
      </div>
      <div className={`${block} h-[210px] rounded-[18px]`} />
      <div className={`${block} h-[150px] rounded-[18px]`} />
    </div>
  );
}
