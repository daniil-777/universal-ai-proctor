import { ArrowUpRight } from "lucide-react";
import icon from "@/assets/demtsev-icon.svg";
import "./developer-credit.css";

/** Local copy of the developer's own website icon; no remote image request. */
export function DeveloperCredit() {
  return (
    <a
      className="developer-credit"
      href="https://demtsev.com/"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Developed by demtsev.com — opens in a new tab"
    >
      <img src={icon} width="22" height="22" alt="" decoding="async" />
      <span className="developer-credit-label">Developed by</span>
      <span className="developer-credit-domain">demtsev.com</span>
      <ArrowUpRight aria-hidden="true" />
    </a>
  );
}
