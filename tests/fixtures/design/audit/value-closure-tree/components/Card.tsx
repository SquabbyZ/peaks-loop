export function Card({ title }: { title: string }) {
  return (
    <div className="p-[13px] rounded-[3px]">
      <div className="gap-[9px] rounded-[5px]">
        <div className="mt-[15px] rounded-[7px] rounded-[9px]">{title}</div>
      </div>
    </div>
  );
}
