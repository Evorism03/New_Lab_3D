"use client";

import { Bounds, Center, OrbitControls } from "@react-three/drei";
import { Canvas, useLoader } from "@react-three/fiber";
import { Suspense } from "react";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

function StlMesh({ url }: { url: string }) {
  const geometry = useLoader(STLLoader, url);
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color="#7fbf7f" roughness={0.4} metalness={0.1} />
    </mesh>
  );
}

function ObjMesh({ url }: { url: string }) {
  const obj = useLoader(OBJLoader, url);
  return <primitive object={obj} />;
}

export function ModelViewer({ fileUrl, format }: { fileUrl: string; format: "STL" | "OBJ" }) {
  return (
    <div className="h-full w-full overflow-hidden rounded-2xl border border-border bg-bg-soft">
      <Canvas camera={{ position: [80, 60, 80], fov: 40 }} shadows>
        <ambientLight intensity={0.9} />
        <directionalLight position={[100, 120, 80]} intensity={1.3} castShadow />
        <Suspense fallback={null}>
          <Bounds fit clip observe margin={1.3}>
            <Center>{format === "STL" ? <StlMesh url={fileUrl} /> : <ObjMesh url={fileUrl} />}</Center>
          </Bounds>
        </Suspense>
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  );
}
