'use client';
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useMapStore } from '@/features/map/store';

/** Cursor feedback + clears hover when the pointer leaves the canvas. Picking itself uses R3F raycasting. */
export function ObjectPicker() {
  const gl = useThree((s) => s.gl);
  const hover = useMapStore((s) => s.hover);
  const setHover = useMapStore((s) => s.setHover);
  useEffect(() => {
    gl.domElement.style.cursor = hover ? 'pointer' : 'grab';
  }, [hover, gl]);
  useEffect(() => {
    const el = gl.domElement;
    const leave = () => setHover(null);
    el.addEventListener('pointerleave', leave);
    return () => el.removeEventListener('pointerleave', leave);
  }, [gl, setHover]);
  return null;
}
