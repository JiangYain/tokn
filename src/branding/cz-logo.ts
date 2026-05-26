export const CZ_LOGO_VIEW_BOX = "0 0 732 732";
export const CZ_LOGO_TRAY_VIEW_BOX = "0 20 732 732";
export const CZ_LOGO_GROUP_TRANSFORM =
  "translate(-78,-133.5) translate(0,499.5) scale(1,0.8541423571) translate(0,-499.5)";
export const CZ_LOGO_PRIMARY_PATH =
  "M 280 71 L 78 214 L 78 928 L 552 928 L 552 854 L 169 852 L 299 722 L 603 722 L 608 695 L 307 694 L 307 316 L 280 316 L 280 702 L 152 829 L 152 290 L 552 289 L 552 215 L 128 213 L 288 98 L 754 98 L 806 71 Z";
export const CZ_LOGO_ACCENT_PATH =
  "M 810 103 L 594 215 L 597 287 L 716 229 L 594 927 L 666 927 L 810 783 L 807 700 L 688 803 Z";

export function getCzLogoSvgMarkup(options?: {
  primaryColor?: string;
  accentColor?: string;
  viewBox?: string;
}) {
  const resolvedOptions = options ?? {};
  const primaryColor = resolvedOptions.primaryColor ?? "#111111";
  const accentColor = resolvedOptions.accentColor ?? "#D94632";
  const viewBox = resolvedOptions.viewBox ?? CZ_LOGO_VIEW_BOX;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">`,
    `  <g transform="${CZ_LOGO_GROUP_TRANSFORM}">`,
    `    <path d="${CZ_LOGO_PRIMARY_PATH}" fill="${primaryColor}"/>`,
    `    <path d="${CZ_LOGO_ACCENT_PATH}" fill="${accentColor}"/>`,
    "  </g>",
    "</svg>",
  ].join("");
}
