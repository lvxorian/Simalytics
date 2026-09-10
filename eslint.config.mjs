import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// eslint-config-next v16 exportuje flat config nativně – FlatCompat
// (přes @eslint/eslintrc) padal na "Converting circular structure to JSON".
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Ikony komodit načítáme přímo z CDN SimCompanies (malé PNG)
      "@next/next/no-img-element": "off",
      // React Compiler pravidla (nová v eslint-config-next v16) kolidují se
      // záměrně imperativní architekturou overlayů grafu (canvas VP/pravítko,
      // ref manipulace, setState v effectech u live store) – viz CLAUDE.md.
      // Plošně jako warning, aby `npm run lint` prošel; reálné bugs hlásí dál.
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
];

export default eslintConfig;
