import { RowList } from '../components/RowList';

export function UsersPage({ rows }: { rows: Array<{ id: string; name: string }> }) {
  return (
    <section>
      <h1 className="text-2xl font-bold text-ink">Users</h1>
      <table>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="text-base text-muted">{row.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <RowList rows={rows} />
    </section>
  );
}
