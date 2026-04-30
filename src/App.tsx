import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import { Delaunay } from "d3-delaunay";

type SoilType = "Sand" | "Clay" | "Gravel" | "Rock";

type SoilInterval = {
  topDepth: number;
  bottomDepth: number;
  soilType: SoilType;
};

type Boring = {
  id: string;
  x: number;
  y: number;
  elevation: number;
  intervals: SoilInterval[];
};

// type ProfilePoint = {
//   id: string;
//   distance: number;
//   elevations: Record<SoilType, number>;
// };

type ProfilePoint = {
  distance: number;
  elevations: Record<SoilType, number>;
};

const soilTypes: SoilType[] = ["Sand", "Clay", "Gravel", "Rock"];

const sectionStart = new THREE.Vector3(-110, -55, 720);
const sectionEnd = new THREE.Vector3(115, 55, 720);

function getSoilColor(soilType: SoilType) {
  switch (soilType) {
    case "Sand":
      return "gold";
    case "Clay":
      return "tomato";
    case "Gravel":
      return "gray";
    case "Rock":
      return "darkslategray";
    default:
      return "white";
  }
}

function getBoundaryDepth(boring: Boring, soilType: SoilType) {
  const soilIndex = soilTypes.indexOf(soilType);
  const exact = boring.intervals.find((i) => i.soilType === soilType);

  if (exact) return exact.topDepth;

  // Generic pinch-out logic:
  // If this layer is missing, use the top depth of the next deeper available layer.
  for (let i = soilIndex + 1; i < soilTypes.length; i++) {
    const nextDeeperSoil = soilTypes[i];
    const nextInterval = boring.intervals.find(
      (interval) => interval.soilType === nextDeeperSoil
    );

    if (nextInterval) {
      return nextInterval.topDepth;
    }
  }

  // If nothing deeper exists, pinch to bottom of deepest interval.
  const deepest = boring.intervals[boring.intervals.length - 1];
  return deepest ? deepest.bottomDepth : null;
}

function getBoundaryElevation(boring: Boring, soilType: SoilType) {
  const depth = getBoundaryDepth(boring, soilType);
  return depth === null ? null : boring.elevation - depth;
}

type SurfaceSamplePoint = {
  x: number;
  y: number;
  z: number;
};

function buildSurfacePoints(borings: Boring[], soilType: SoilType) {
  return borings
    .map((b) => {
      const z = getBoundaryElevation(b, soilType);
      if (z === null) return null;

      return {
        x: b.x,
        y: b.y,
        z,
      };
    })
    .filter((p): p is SurfaceSamplePoint => p !== null);
}

function barycentricInterpolateZ(
  p: THREE.Vector2,
  a: SurfaceSamplePoint,
  b: SurfaceSamplePoint,
  c: SurfaceSamplePoint
) {
  const v0 = new THREE.Vector2(b.x - a.x, b.y - a.y);
  const v1 = new THREE.Vector2(c.x - a.x, c.y - a.y);
  const v2 = new THREE.Vector2(p.x - a.x, p.y - a.y);

  const d00 = v0.dot(v0);
  const d01 = v0.dot(v1);
  const d11 = v1.dot(v1);
  const d20 = v2.dot(v0);
  const d21 = v2.dot(v1);

  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-9) return null;

  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  const u = 1 - v - w;

  const tolerance = -0.001;

  if (u < tolerance || v < tolerance || w < tolerance) {
    return null;
  }

  return u * a.z + v * b.z + w * c.z;
}

function sampleSurfaceAtPoint(
  borings: Boring[],
  soilType: SoilType,
  point: THREE.Vector2
) {
  const surfacePoints = buildSurfacePoints(borings, soilType);

  if (surfacePoints.length < 3) return null;

  const delaunay = Delaunay.from(surfacePoints.map((p) => [p.x, p.y]));
  const triangles = delaunay.triangles;

  for (let i = 0; i < triangles.length; i += 3) {
    const a = surfacePoints[triangles[i]];
    const b = surfacePoints[triangles[i + 1]];
    const c = surfacePoints[triangles[i + 2]];

    const z = barycentricInterpolateZ(point, a, b, c);

    if (z !== null) {
      return z;
    }
  }

  return null;
}

function buildSampledProfilePoints(
  borings: Boring[],
  stationSpacing = 5
): ProfilePoint[] {
  const start = new THREE.Vector2(sectionStart.x, sectionStart.y);
  const end = new THREE.Vector2(sectionEnd.x, sectionEnd.y);

  const line = end.clone().sub(start);
  const length = line.length();
  const direction = line.clone().normalize();

  const profilePoints: ProfilePoint[] = [];

  for (let distance = 0; distance <= length; distance += stationSpacing) {
    const point = start.clone().add(direction.clone().multiplyScalar(distance));

    const elevations = {} as Record<SoilType, number>;
    let valid = true;

    soilTypes.forEach((soilType) => {
      const z = sampleSurfaceAtPoint(borings, soilType, point);

      if (z === null) {
        valid = false;
      } else {
        elevations[soilType] = z;
      }
    });

    if (valid) {
      profilePoints.push({
        distance,
        elevations,
      });
    }
  }

  return profilePoints;
}

// function getProjectionDistanceAlongSection(boring: Boring) {
//   const start = new THREE.Vector2(sectionStart.x, sectionStart.y);
//   const end = new THREE.Vector2(sectionEnd.x, sectionEnd.y);
//   const point = new THREE.Vector2(boring.x, boring.y);

//   const line = end.clone().sub(start);
//   const toPoint = point.clone().sub(start);

//   const t = toPoint.dot(line) / line.lengthSq();
//   return t * line.length();
// }

// function buildProfilePoints(borings: Boring[]): ProfilePoint[] {
//   return borings
//     .map((b) => {
//       const elevations = {} as Record<SoilType, number>;

//       soilTypes.forEach((soilType) => {
//         const elevation = getBoundaryElevation(b, soilType);
//         elevations[soilType] = elevation ?? b.elevation;
//       });

//       return {
//         id: b.id,
//         distance: getProjectionDistanceAlongSection(b),
//         elevations,
//       };
//     })
//     .sort((a, b) => a.distance - b.distance);
// }

function makeTestBorings(): Boring[] {
  const borings: Boring[] = [];

  for (let i = 0; i < 50; i++) {
    const row = Math.floor(i / 10);
    const col = i % 10;

    const x = -90 + col * 20 + Math.sin(i * 1.7) * 4;
    const y = -40 + row * 20 + Math.cos(i * 1.3) * 5;
    const elevation = 700 + Math.sin(i * 0.55) * 7 + col * 0.6;

    const sandBottom = 6 + ((i * 3) % 12);
    const clayBottom = sandBottom + 8 + ((i * 5) % 16);
    const gravelBottom = clayBottom + 6 + ((i * 7) % 12);
    const rockBottom = gravelBottom + 16;

    const intervals: SoilInterval[] = [];

    const removeSand = i % 17 === 0;
    const removeClay = i % 7 === 0 || i % 13 === 0;
    const removeGravel = i % 9 === 0 || i % 19 === 0;

    if (!removeSand) {
      intervals.push({
        topDepth: 0,
        bottomDepth: sandBottom,
        soilType: "Sand",
      });
    }

    if (!removeClay) {
      intervals.push({
        topDepth: removeSand ? 0 : sandBottom,
        bottomDepth: clayBottom,
        soilType: "Clay",
      });
    }

    if (!removeGravel) {
      intervals.push({
        topDepth: removeClay ? sandBottom : clayBottom,
        bottomDepth: gravelBottom,
        soilType: "Gravel",
      });
    }

    intervals.push({
      topDepth: removeGravel ? clayBottom : gravelBottom,
      bottomDepth: rockBottom,
      soilType: "Rock",
    });

    borings.push({
      id: `B${i + 1}`,
      x,
      y,
      elevation,
      intervals,
    });
  }

  return borings;
}

function SoilIntervalMesh({
  boring,
  interval,
}: {
  boring: Boring;
  interval: SoilInterval;
}) {
  const height = interval.bottomDepth - interval.topDepth;
  const topZ = boring.elevation - interval.topDepth;
  const bottomZ = boring.elevation - interval.bottomDepth;
  const centerZ = (topZ + bottomZ) / 2;

  return (
    <mesh
      position={[boring.x, boring.y, centerZ]}
      rotation={[Math.PI / 2, 0, 0]}
    >
      <cylinderGeometry args={[1.2, 1.2, height, 20]} />
      <meshStandardMaterial color={getSoilColor(interval.soilType)} />
    </mesh>
  );
}

function BoundarySurface({
  borings,
  soilType,
  opacity = 0.22,
}: {
  borings: Boring[];
  soilType: SoilType;
  opacity?: number;
}) {
  const points: [number, number][] = [];
  const vertices: number[] = [];
  const indices: number[] = [];

  borings.forEach((b) => {
    const elevation = getBoundaryElevation(b, soilType);
    if (elevation === null) return;

    points.push([b.x, b.y]);
    vertices.push(b.x, b.y, elevation);
  });

  if (points.length < 3) return null;

  const delaunay = Delaunay.from(points);
  const triangles = delaunay.triangles;

  for (let i = 0; i < triangles.length; i += 3) {
    indices.push(triangles[i], triangles[i + 1], triangles[i + 2]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={getSoilColor(soilType)}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

function BoringMesh({ boring }: { boring: Boring }) {
  return (
    <>
      {boring.intervals.map((interval, index) => (
        <SoilIntervalMesh
          key={`${boring.id}-${index}`}
          boring={boring}
          interval={interval}
        />
      ))}

      <mesh position={[boring.x, boring.y, boring.elevation]}>
        <sphereGeometry args={[1.6, 16, 16]} />
        <meshStandardMaterial color="black" />
      </mesh>

      <Text
        position={[boring.x + 3, boring.y + 3, boring.elevation + 3]}
        fontSize={2.2}
        color="black"
        anchorX="center"
        anchorY="middle"
      >
        {boring.id}
      </Text>
    </>
  );
}

function SectionLine() {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    sectionStart,
    sectionEnd,
  ]);

  return (
    <line geometry={geometry}>
      <lineBasicMaterial color="blue" />
    </line>
  );
}

function ProfileLayer({
  points,
  topSoil,
  bottomSoil,
}: {
  points: ProfilePoint[];
  topSoil: SoilType;
  bottomSoil: SoilType;
}) {
  const vertices: number[] = [];
  const indices: number[] = [];

  points.forEach((p) => {
    vertices.push(p.distance, 0, p.elevations[topSoil]);
  });

  points.forEach((p) => {
    vertices.push(p.distance, 0, p.elevations[bottomSoil]);
  });

  for (let i = 0; i < points.length - 1; i++) {
    const topA = i;
    const topB = i + 1;
    const botA = i + points.length;
    const botB = i + 1 + points.length;

    indices.push(topA, botA, topB);
    indices.push(topB, botA, botB);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={getSoilColor(topSoil)}
        side={THREE.DoubleSide}
        transparent
        opacity={0.9}
      />
    </mesh>
  );
}

function ProfileView({ borings }: { borings: Boring[] }) {
  const profilePoints = buildSampledProfilePoints(borings, 5);

  return (
    <Canvas orthographic camera={{ position: [115, -220, 700], zoom: 3 }}>
      <ambientLight intensity={0.8} />
      <pointLight position={[50, -80, 760]} />

      <OrbitControls target={[115, 0, 680]} />

      <ProfileLayer points={profilePoints} topSoil="Sand" bottomSoil="Clay" />
      <ProfileLayer points={profilePoints} topSoil="Clay" bottomSoil="Gravel" />
      <ProfileLayer points={profilePoints} topSoil="Gravel" bottomSoil="Rock" />

      {profilePoints.map((p, index) => {
        if (index % 5 !== 0) return null;

        return (
          <Text
            key={index}
            position={[p.distance, 0, p.elevations.Sand + 4]}
            fontSize={2}
            color="black"
            anchorX="center"
            anchorY="middle"
          >
            {`${Math.round(p.distance)}'`}
          </Text>
        );
      })}
    </Canvas>
  );
}

function SiteView({ borings }: { borings: Boring[] }) {
  return (
    <Canvas camera={{ position: [150, -170, 750], fov: 45 }}>
      <ambientLight intensity={0.7} />
      <pointLight position={[50, -50, 760]} />

      <OrbitControls target={[0, 0, 680]} />

      <BoundarySurface borings={borings} soilType="Sand" opacity={0.12} />
      <BoundarySurface borings={borings} soilType="Clay" opacity={0.18} />
      <BoundarySurface borings={borings} soilType="Gravel" opacity={0.22} />
      <BoundarySurface borings={borings} soilType="Rock" opacity={0.28} />

      <SectionLine />

      {borings.map((b) => (
        <BoringMesh key={b.id} boring={b} />
      ))}
    </Canvas>
  );
}

function App() {
  const borings = makeTestBorings();

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "grid",
        gridTemplateRows: "1fr 1fr",
      }}
    >
      <div style={{ borderBottom: "1px solid #ccc" }}>
        <SiteView borings={borings} />
      </div>

      <div>
        <ProfileView borings={borings} />
      </div>
    </div>
  );
}

export default App;