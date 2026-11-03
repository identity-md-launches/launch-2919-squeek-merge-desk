/** Original desk illustration, not an NFT preview or a fabricated holding. */
export function SqueekArt({ small = false, variant = 0 }: { small?: boolean; variant?: number }) {
  return <svg className={`squeek-art ${small ? 'squeek-art-small' : ''}`} viewBox="0 0 100 100" fill="none" aria-hidden="true">
    <path d="M23 35V19H36V27H64V19H77V35H84V68H76V79H62V84H38V79H24V68H16V35H23Z" fill="currentColor" fillOpacity=".09" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <path d="M25 33V23H32V30M68 30V23H75V33" stroke="currentColor" strokeWidth="2" />
    {variant === 1 ? <><path d="M31 47H40M60 47H69" stroke="currentColor" strokeWidth="3" /><path d="M44 57H56L50 63L44 57Z" fill="currentColor" /></> : <><rect x="32" y="42" width="7" height="9" rx="2" fill="currentColor" /><rect x="61" y="42" width="7" height="9" rx="2" fill="currentColor" /><path d="M45 58H55L50 63Z" fill="currentColor" /></>}
    <path d="M39 67L45 70L50 66L55 70L61 67M22 57H34M20 64H33M66 57H78M67 64H80" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
}
