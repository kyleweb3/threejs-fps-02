// DUSTLINE — threejs-fps-02 — palette: desert dusk colours for the relay station map.
// Ten named colours live in one place so the map, HUD and effects agree.

export const PALETTE = {
  canvas: '#191410',
  surface: '#2a2118',
  hairline: '#4a3a28',
  ink: '#f2e8d5',
  muted: '#a89a80',
  accent: '#ff9a2a',
  enemy: '#d84a2b',
  friend: '#4fb3a9',
  sand: '#c8a25e',
  dark: '#14100c',
};

// One shared MeshStandardMaterial per palette colour, plus a glossy blue
// glass for canopies and visors. Materials are built fresh on every call,
// so a new scene never shares material state with an old one.
export function makeMaterials(THREE) {
  const mats = {};
  for (const [name, hex] of Object.entries(PALETTE)) {
    mats[name] = new THREE.MeshStandardMaterial({
      color: hex,
      roughness: name === 'accent' ? 0.55 : 0.92,
      metalness: 0.0,
    });
  }
  // The darkest tone of the set, kept fully matte so it reads as deep shade.
  mats.dark.roughness = 1.0;
  mats.glass = new THREE.MeshStandardMaterial({
    color: '#8fc3e8',
    roughness: 0.12,
    metalness: 0.15,
    transparent: true,
    opacity: 0.38,
  });
  return mats;
}
