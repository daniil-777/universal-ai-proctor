import { BlockList, isIP } from "node:net";

/** Trust one immediate reverse proxy, never another address in a forwarded chain. */
export function proxyTrust(cidrs = ""): false | ((address: string, hop: number) => boolean) {
  if (!cidrs.trim()) return false;
  const proxies = new BlockList();
  for (const entry of cidrs.split(",")) {
    const parts = entry.trim().split("/");
    const address = parts[0] || "";
    const family = isIP(address);
    if (parts.length !== 2 || !family || parts[1] !== (family === 4 ? "32" : "128")) {
      throw new Error("TRUST_PROXY_CIDRS must contain exact IPv4 /32 or IPv6 /128 proxy addresses, separated by commas.");
    }
    proxies.addAddress(address, family === 4 ? "ipv4" : "ipv6");
  }
  return (address, hop) => {
    const family = isIP(address);
    return hop === 0 && family !== 0 && proxies.check(address, family === 4 ? "ipv4" : "ipv6");
  };
}
