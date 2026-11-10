'use client';
import { Component, forwardRef, Suspense, type ReactNode } from 'react';
import type * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { useAssetModel } from '@/lib/three/asset-loader';
import { toonMaterial } from '@/lib/three/materials';

/** Keeps one broken/missing GLB from taking down the whole scene. */
class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.warn('[map] asset failed to load:', error.message); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const placeholder = () => (
  <mesh position-y={1.5} material={toonMaterial('#e7d6bd', { key: 'placeholder' })}><boxGeometry args={[3, 3, 3]} /></mesh>
);

function Model({ url }: { url: string }) {
  const obj = useAssetModel(url);
  return <primitive object={obj} />;
}

export interface AssetInstanceProps {
  url: string;
  position: [number, number, number];
  rotationY: number;
  scale: [number, number, number];
  onPointerOver?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut?: (e: ThreeEvent<PointerEvent>) => void;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  children?: React.ReactNode;
  placeId?: string | null;
}

/** A positioned GLB asset; geometry/materials are shared between all instances of the same asset. */
export const AssetInstance = forwardRef<THREE.Group, AssetInstanceProps>(function AssetInstance(
  { url, position, rotationY, scale, onPointerOver, onPointerOut, onClick, children, placeId }, ref,
) {
  return (
    <group ref={ref} position={position} rotation-y={rotationY} scale={scale} userData={placeId ? { placeId } : undefined} onPointerOver={onPointerOver} onPointerOut={onPointerOut} onClick={onClick}>
      <ModelErrorBoundary fallback={placeholder()}>
        <Suspense fallback={placeholder()}>
          <Model url={url} />
        </Suspense>
      </ModelErrorBoundary>
      {children}
    </group>
  );
});
