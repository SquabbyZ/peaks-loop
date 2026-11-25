export function StatesComparisonPage({ before, after }: { before: string; after: string }) {
  if (before === after) {
    return <p role="status">No source changes</p>;
  }
  return (
    <table>
      <tbody>
        {before.split('\n').map((line) => (
          <tr key={line}>
            <td>{line}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
