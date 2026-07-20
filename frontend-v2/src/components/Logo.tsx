/**
 * The Pulldasher mark: a stag ("Dasher") whose antlers branch like a commit
 * graph, each tine ending in a node — the pun and the product in one glyph.
 * Monochrome and drawn in currentColor so the header can tint it brand and a
 * favicon can invert it; built from a solid head plus stroked antler branches
 * with filled nodes, symmetric so it stays crisp down to favicon size.
 */
export function Logo({ size = 22, className = '' }: { size?: number; className?: string }) {
   // one antler, drawn on the left; the right is the same paths mirrored, so
   // the branch graph is exactly symmetric at any size
   const antler = (
      <>
         <path
            d="M15 14.5C13.6 12.8 12.4 11.6 11.5 9.2M12.9 11.4C11.6 10.9 10.3 10.9 9 10.4M12 9.6C12.2 8 12.6 6.8 13.2 5.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
         />
         <circle cx="11.5" cy="9.2" r="1.15" />
         <circle cx="9" cy="10.4" r="1.05" />
         <circle cx="13.2" cy="5.4" r="1.05" />
      </>
   );
   return (
      <svg
         viewBox="0 0 32 32"
         width={size}
         height={size}
         className={className}
         role="img"
         aria-label="Pulldasher"
         fill="currentColor"
      >
         {antler}
         <g transform="translate(32,0) scale(-1,1)">{antler}</g>
         {/* the head: brow, cheeks, tapering muzzle */}
         <path d="M16 13.4c-2.5 0-4 1.6-4.2 3.7-.2 2 .2 4 1.6 5.9.9 1.3 1.7 2.4 2.6 3.1.9-.7 1.7-1.8 2.6-3.1 1.4-1.9 1.8-3.9 1.6-5.9-.2-2.1-1.7-3.7-4.2-3.7Z" />
         {/* ears */}
         <path d="M12 15.2c-1.4-1-2.6-.8-3.1.3-.4 1 .2 2.1 1.6 2.3 1-.5 1.5-1.5 1.5-2.6Z" />
         <path d="M20 15.2c1.4-1 2.6-.8 3.1.3.4 1-.2 2.1-1.6 2.3-1-.5-1.5-1.5-1.5-2.6Z" />
         {/* muzzle tip */}
         <circle cx="16" cy="24.3" r="1.05" />
      </svg>
   );
}
