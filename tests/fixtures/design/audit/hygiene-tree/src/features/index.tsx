import { useQuery } from '@tanstack/react-query';
import { mockRows } from './__mocks__/rows';
import { Row } from './components/row';

export function AboutPage() {
  const { data } = useQuery({ queryKey: ['about'], queryFn: () => fetch('/api/about') });
  const rows = data ?? mockRows();
  return (
    <section className="text-base">
      <h1 className="text-xl font-bold">About</h1>
      <Row label="rows" />
      <p className="text-base">{rows.length}</p>
    </section>
  );
}
