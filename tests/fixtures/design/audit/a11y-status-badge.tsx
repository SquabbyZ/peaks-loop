export function StatusBadge({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <span data-slot="status-badge" onClick={onClick}>
      {label}
    </span>
  );
}
