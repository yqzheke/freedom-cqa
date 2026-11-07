import core from "eslint-config-next/core-web-vitals";
const config = [
  ...core,
  { ignores: [".next/**", ".cqa/**", "test-results/**"] },
  { rules: { "react-hooks/set-state-in-effect": "off" } },
];

export default config;
