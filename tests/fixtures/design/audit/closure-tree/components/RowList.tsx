export function RowList({
  rows,
  error
}: {
  rows: Array<{ id: string; name: string }>;
  error?: string;
}) {
  if (error) return <p>Could not load the list.</p>;
  if (rows.length === 0) return <p>No rows yet.</p>;
  return (
    <ul>
      {rows.map((row) => (
        <li key={row.id}>{row.name}</li>
      ))}
    </ul>
  );
}
