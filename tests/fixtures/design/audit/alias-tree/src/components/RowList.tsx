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
    <section>
      <h1 className="text-2xl font-bold text-ink">Rows</h1>
      <ul className="text-base text-muted">
        {rows.map((row) => (
          <li key={row.id}>{row.name}</li>
        ))}
      </ul>
    </section>
  );
}
