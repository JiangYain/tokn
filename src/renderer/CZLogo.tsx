import {
  CZ_LOGO_ACCENT_PATH,
  CZ_LOGO_GROUP_TRANSFORM,
  CZ_LOGO_PRIMARY_PATH,
  CZ_LOGO_VIEW_BOX,
} from "../branding/cz-logo.js";

export function CZLogo({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox={CZ_LOGO_VIEW_BOX} aria-label="Tokn logo">
      <g transform={CZ_LOGO_GROUP_TRANSFORM}>
        <path d={CZ_LOGO_PRIMARY_PATH} fill="currentColor" />
        <path d={CZ_LOGO_ACCENT_PATH} fill="#D94632" />
      </g>
    </svg>
  );
}
