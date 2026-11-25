export function StatesCleanPage({ items, error }: { items: string[]; error?: string }) {
  if (error) return <p>Something went wrong.</p>;
  if (items.length === 0) return <p>No data yet.</p>;
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
