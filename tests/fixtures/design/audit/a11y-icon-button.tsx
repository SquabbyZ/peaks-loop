export function IconButton({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="focus-visible:ring-2">
      {label}
    </button>
  );
}
