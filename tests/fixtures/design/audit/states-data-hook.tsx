export function useRows(): string[] {
  const { data } = useQuery({ queryKey: ['rows'] });
  return data ?? [];
}
