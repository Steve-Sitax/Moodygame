import * as THREE from "three";

// The quay walls and their copings (D2, 2026-10-11; Steve: "make docks look way better"). The pictures and their
// height maps are our own, made by tools/textures/quay_maps.py (it reads the numbers below from this file, so the
// two never differ):
// - the wall: coursed bluestone (arduin) ashlar in level courses, lime joints, and the tide's marks at their true
//   heights: salt bloom over the high-water line, the dark tide mark, a brown film with barnacles, green weed from
//   half tide to low water, black mussels and wrack at the foot. u runs on along each quay ring (city.ts), v is the
//   height: the picture covers the whole wall, QUAY_Y_LO to QUAY_Y_HI, and tiles only along it.
// - the coping: bluestone blocks with a rounded nose and iron cramps leaded in across the joints, its section
//   unrolled down the picture (COPE_SECTION).

/**
 * A painted texture now, swapped for a picture from client/public/textures when that has loaded (the pictures
 * of the quays: tools/textures/quay_maps.py; others: assets/ATTRIBUTION.md). If it fails, the painted one stays.
 */
export function withPicture(tex: THREE.Texture, url: string): THREE.Texture {
  // (the bump audit: the picture's name says what the surface is, world/bumps.ts)
  tex.userData.picture = url.replace(/^.*\//, "");
  const img = new Image();
  img.onload = () => {
    tex.image = img;
    // (another size than the painted one: free the first upload's storage, or the painted one stays; paving.ts swapped)
    tex.dispose();
    tex.needsUpdate = true;
    (tex.userData.onPicture as (() => void) | undefined)?.();
  };
  img.onerror = () => console.warn("texture picture did not load", url);
  img.src = url;
  return tex;
}

/** The wall picture's foot and top (m, the quay top 0): the whole wall's height, so the tide's marks sit where they belong. */
export const QUAY_Y_LO = -6.4;
export const QUAY_Y_HI = 1.2;
/** Metres along the wall that the wall picture covers before it repeats. */
export const QUAY_WALL_ALONG = 8;
/**
 * The wall's courses from QUAY_Y_LO up (m): fifteen up to the coping's foot (-0.28), then four more for the flights'
 * parapets and piers. Read by quay_maps.py; the flights cut their slabs from these courses (quaysteps.ts).
 */
export const QUAY_COURSES = [0.46, 0.44, 0.4, 0.42, 0.38, 0.44, 0.4, 0.36, 0.42, 0.4, 0.38, 0.42, 0.4, 0.38, 0.42, 0.34, 0.38, 0.36, 0.4];
/** Metres along the quay that the coping picture covers. */
export const QUAY_COPE_ALONG = 4;
/**
 * The coping's section unrolled (m round it, from the land side): the land face (6 cm), the top, the rounded nose
 * (5 cm radius), the face over the water down to -0.28, the underside back to the wall line, the end.
 */
export const COPE_SECTION = [0, 0.06, 0.495, 0.5735, 0.8635, 1.0985];
/** The coping's sizes (city.ts): half its width either side of the quay line, its top, its nose, its foot. */
export const COPE = { half: 0.25, front: 0.235, top: 0.06, nose: 0.05, foot: -0.28 };

/** v on the wall picture at height y. */
export const wallV = (y: number) => (y - QUAY_Y_LO) / (QUAY_Y_HI - QUAY_Y_LO);

/** The courses' feet and tops (m). */
export const COURSE_BEDS: Array<[number, number]> = (() => {
  const out: Array<[number, number]> = [];
  let y = QUAY_Y_LO;
  for (const c of QUAY_COURSES) {
    out.push([y, y + c]);
    y += c;
  }
  return out;
})();

/** The course at height y (its index in COURSE_BEDS). */
export function courseAt(y: number): number {
  for (let i = 0; i < COURSE_BEDS.length; i++) if (y < COURSE_BEDS[i][1]) return i;
  return COURSE_BEDS.length - 1;
}

/**
 * v of a point m metres into course k (from its top joint down), kept inside the course, clear of its joints, for as
 * far as the course is high: where a slab cut from the wall's stone takes its picture.
 */
export function courseV(k: number, m: number): number {
  const [b, t] = COURSE_BEDS[Math.max(0, Math.min(COURSE_BEDS.length - 1, k))];
  const y = Math.max(b + 0.02, t - 0.02 - Math.max(0, m));
  return wallV(y);
}

/** A flat stand-in until a picture is in: a plain colour (or a mid grey for a height map), 4 px. */
function flat(rgb: string, colour: boolean): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 4;
  const g = c.getContext("2d")!;
  g.fillStyle = rgb;
  g.fillRect(0, 0, 4, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** The wall's picture and its height map (quay_maps.py): u along the wall (QUAY_WALL_ALONG a tile), v = wallV(y). */
export function quayWallMaps(): { map: THREE.Texture; height: THREE.Texture } {
  return {
    map: withPicture(flat("#6a6e70", true), "/textures/quay_wall_c.jpg"),
    height: withPicture(flat("#808080", false), "/textures/quay_wall_h.png"),
  };
}

/** The coping's picture and height map: u along the quay (QUAY_COPE_ALONG a tile), v down its section (COPE_SECTION). */
export function quayCopingMaps(): { map: THREE.Texture; height: THREE.Texture } {
  return {
    map: withPicture(flat("#7c7e7e", true), "/textures/quay_coping_c.jpg"),
    height: withPicture(flat("#808080", false), "/textures/quay_coping_h.png"),
  };
}
