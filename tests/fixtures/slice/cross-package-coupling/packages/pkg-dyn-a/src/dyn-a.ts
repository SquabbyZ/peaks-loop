export async function dynA(): Promise<number> {
  const mod = await import('@slice/pkg-dyn-b');
  return mod.dynValue + 1;
}
