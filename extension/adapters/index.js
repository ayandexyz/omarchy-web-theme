// Hand-written site adapters, for sites the Catppuccin community styles don't
// cover. None ship by default: every site gets its community style when one
// matches, and the general engine always. Each adapter can have:
//   id        a short name, used to tell when the adapter changed
//   match     (host) => true for the sites it applies to
//   colorMap  exact site colors ("r,g,b") -> palette slot, checked before the
//             general mapping (good for sites with hard-coded colors)
//   css(p)    extra CSS appended after the general engine's output, usually to
//             point a site's own CSS variables at the palette. `p` holds
//             "rgb(...)" strings keyed by palette slot name.
//   generic   false to skip the general engine entirely (default true)
//
// Example:
//   {
//     id: "example",
//     match: (host) => host === "example.com",
//     colorMap: { "15,15,15": "background" },
//     css: (p) => `:root { --page-bg: ${p.background} !important; }`,
//   },
(function (root) {
  const OWT = (root.OWT = root.OWT || {});

  const adapters = [];

  function adapterFor(host) {
    return adapters.find((a) => a.match(host)) || null;
  }

  OWT.adapters = { adapters, adapterFor };

  if (typeof module !== "undefined") module.exports = OWT.adapters;
})(globalThis);
