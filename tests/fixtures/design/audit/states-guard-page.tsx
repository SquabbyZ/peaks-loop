export function StatesGuardPage({ domains }: { domains: string[] }) {
  if (domains.length < 2) return null;
  return (
    <section>
      <h1 className="text-base">Choose a domain</h1>
      <ul>
        {domains.map((domain) => (
          <li key={domain}>{domain}</li>
        ))}
      </ul>
    </section>
  );
}
