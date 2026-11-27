export type CardProps = {
  padding?: 'none' | 'sm' | 'md';
  children: React.ReactNode;
};

/** A surface container; the padding ladder is the only growth axis. */
export function Card({ padding = 'md', children }: CardProps) {
  return <section className={`pk-card pk-card--${padding}`}>{children}</section>;
}
