export type ProxyTestResult = {
  proxy: string;
  target: string;
  dryRun: boolean;
  commandPreview: string;
};

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function validateUrl(value: string, label: string): void {
  if (!value.startsWith('http://') && !value.startsWith('https://')) {
    throw new Error(`${label} URL must start with http:// or https://`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} URL must be a valid URL`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} URL must start with http:// or https://`);
  }

  if (url.username || url.password) {
    throw new Error(`${label} URL must not include credentials`);
  }
}

export function planProxyTest(proxy: string, target = 'https://www.google.com', dryRun = true): ProxyTestResult {
  validateUrl(proxy, 'Proxy');
  validateUrl(target, 'Target');

  return {
    proxy,
    target,
    dryRun,
    commandPreview: `curl -x ${shellQuote(proxy)} -I ${shellQuote(target)}`
  };
}
