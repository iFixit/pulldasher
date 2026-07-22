import type { ForwardRefExoticComponent, SVGProps } from 'react';

type LucideComponent = ForwardRefExoticComponent<
   SVGProps<SVGSVGElement> & { size?: number | string }
>;

/**
 * The one lucide wrapper every icon in the app renders through (per-icon
 * imports at the call site keep tree-shaking — never `import * as icons`).
 * House defaults: 14px for inline/action icons, pass size={16} for header
 * chrome; lucide's own stroke weight is never overridden here — a second
 * weight would be a second visual family. aria-hidden by default, since an
 * icon almost always rides beside text or inside an already-labeled button;
 * pass aria-hidden={false} (with the caller's own accessible name) on the
 * rare icon that IS the label.
 */
export function Icon({
   icon: Glyph,
   size = 14,
   ...rest
}: { icon: LucideComponent } & SVGProps<SVGSVGElement> & { size?: number | string }) {
   return <Glyph size={size} aria-hidden {...rest} />;
}
