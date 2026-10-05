import * as React from "react";
export function useMediaQuery(query: string) {
  const [matches, setMatches] = React.useState(
    () => window.matchMedia(query).matches,
  );
  React.useEffect(() => {
    const media = window.matchMedia(query);
    const change = () => setMatches(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [query]);
  return matches;
}
export function useIsMobile() {
  return useMediaQuery("(max-width: 767px)");
}
