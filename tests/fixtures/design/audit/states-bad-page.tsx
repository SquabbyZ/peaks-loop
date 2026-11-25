export function StatesBadPage({ rows }: { rows: string[] }) {
  return (
    <table>
      <tbody>
        {rows.map((row) => (
          <tr key={row}>
            <td>{row}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
