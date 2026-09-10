'use client';
import { useEffect, useRef, useState } from 'react';
import type * as Three from 'three';
import { MATERIALS, insidePolygon, type Plan } from '@/lib/model';
import type { MeshData } from '@/lib/voxels';
import { buildingGlb } from '@/lib/gltf';

export type ViewControls = { roofs: boolean; isolate: boolean; explode: boolean; cutX: number; cutZ: number; floor: number };
type Props = { plan: Plan; meshes: MeshData[]; controls: ViewControls; selected?: string; onSelect: (id: string) => void };
type View = 'perspective' | 'front' | 'top';
export default function BuildingViewer({ plan, meshes, controls, selected, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null), live = useRef({ plan, controls, selected, onSelect });
  live.current = { plan, controls, selected, onSelect };
  const update = useRef<(() => void) | null>(null), preset = useRef<((view: View) => void) | null>(null);
  const [error, setError] = useState(''),[exportError,setExportError]=useState('');
  const exportMesh=()=>{try{const data=buildingGlb(meshes,plan.name),url=URL.createObjectURL(new Blob([data as BlobPart],{type:'model/gltf-binary'})),a=document.createElement('a');a.href=url;a.download=plan.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'.glb';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);setExportError('');}catch(cause){setExportError(cause instanceof Error?cause.message:'Mesh export failed.');}};
  useEffect(() => {
    const el = host.current!; let disposed = false;
    const disposers: (() => void)[] = [];
    const cleanup = () => { update.current = null; preset.current = null; for (const dispose of disposers.splice(0).reverse()) dispose(); };
    async function init() {
      try {
        if (new URLSearchParams(window.location.search).get('graphics') === 'off') throw new Error('Plan-only compatibility mode is enabled.');
        const T = await import('three'), { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
        if (disposed) return;
        const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
        disposers.push(() => { renderer.setAnimationLoop(null); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); renderer.localClippingEnabled = true;
        renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
        renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
        renderer.setClearColor('#eae5d9', 1); el.appendChild(renderer.domElement);
        renderer.domElement.setAttribute('aria-label', 'Block-accurate 3D building. Drag to orbit, right-drag to pan, scroll to zoom.');
        const scene = new T.Scene(), camera = new T.PerspectiveCamera(36, 1, .2, 6000), b = plan.bounds;
        const orbit = new OrbitControls(camera, renderer.domElement);
        disposers.push(() => orbit.dispose());
        orbit.enableDamping = true; orbit.dampingFactor = .085; orbit.minDistance = 5; orbit.maxPolarAngle = Math.PI * .49;
        const planes = [new T.Plane(new T.Vector3(-1, 0, 0), 10000), new T.Plane(new T.Vector3(0, 0, -1), 10000),
          new T.Plane(new T.Vector3(0, 1, 0), 10000), new T.Plane(new T.Vector3(0, -1, 0), 10000)];
        const [cutX, cutZ, bottom, top] = planes;
        const materials = new Map<string, Three.MeshStandardMaterial>(), objects: Three.Mesh[] = [], bounds = new T.Box3();
        disposers.push(() => { for (const object of objects) object.geometry.dispose(); for (const material of materials.values()) material.dispose(); });
        for (const data of meshes) {
          const color = data.color ?? MATERIALS[data.material].color, key = `${data.material}/${color}/${data.emissive??''}`;
          let material = materials.get(key);
          if (!material) {
            material = new T.MeshStandardMaterial({ color, emissive:data.emissive??'#000000',emissiveIntensity:data.emissive?1.3:0, roughness: data.material === 4 ? .3 : .88, metalness: 0,
              side: T.DoubleSide, clippingPlanes: planes, clipShadows: true });
            materials.set(key, material);
          }
          const geometry = new T.BufferGeometry();
          geometry.setAttribute('position', new T.BufferAttribute(data.positions, 3));
          geometry.setAttribute('normal', new T.BufferAttribute(data.normals, 3));
          geometry.setIndex(new T.BufferAttribute(data.indices, 1)); geometry.computeBoundingSphere(); geometry.computeBoundingBox();
          if (geometry.boundingBox) bounds.union(geometry.boundingBox);
          const mesh = new T.Mesh(geometry, material); mesh.castShadow = data.material !== 4; mesh.receiveShadow = true;
          mesh.userData = { floor: data.floor, roof: data.roof }; scene.add(mesh); objects.push(mesh);
        }
        if (bounds.isEmpty()) bounds.set(new T.Vector3(b.x, plan.minY, b.z), new T.Vector3(b.x + b.w, plan.maxY, b.z + b.d));
        const center = bounds.getCenter(new T.Vector3()), size = bounds.getSize(new T.Vector3()), radius = Math.max(8, size.length() / 2);
        const fit = (view: View = 'perspective') => {
          const vertical = T.MathUtils.degToRad(camera.fov), horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
          const distance = radius / Math.sin(Math.min(vertical, horizontal) / 2) * 1.12;
          const entry = plan.openings.find(opening => opening.type === 'entrance')?.outward;
          const direction = view === 'front' ? new T.Vector3(entry?.x ?? 0, .06, entry?.z ?? 1).normalize() : view === 'top' ? new T.Vector3(0, 1, .001) : new T.Vector3(.9, .65, 1.1).normalize();
          orbit.target.copy(center); camera.position.copy(center).addScaledVector(direction, distance); orbit.maxDistance = distance * 4;
          camera.near = Math.max(.1, radius / 1000); camera.far = Math.max(4000, distance * 12); camera.updateProjectionMatrix(); orbit.update();
        };
        preset.current = fit;
        scene.add(new T.HemisphereLight(0xf4f3e8, 0x64716d, 1.35));
        const sun = new T.DirectionalLight(0xfff1dc, 3.1); sun.position.copy(center).add(new T.Vector3(-radius, radius * 1.8, radius));
        sun.target.position.copy(center); scene.add(sun, sun.target); sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048); sun.shadow.normalBias = .08; sun.shadow.bias = -.00012;
        Object.assign(sun.shadow.camera, { left: -radius * 1.3, right: radius * 1.3, top: radius * 1.5, bottom: -radius * 1.3, near: .5, far: radius * 6 });
        sun.shadow.camera.updateProjectionMatrix(); disposers.push(() => sun.shadow.dispose());
        const fill = new T.DirectionalLight(0xc8dce6, .75); fill.position.copy(center).add(new T.Vector3(radius, radius * .8, -radius)); scene.add(fill);
        const ground = new T.Mesh(new T.PlaneGeometry(radius * 8, radius * 8), new T.MeshStandardMaterial({ color: '#ddd7c7', roughness: 1 }));
        ground.rotation.x = -Math.PI / 2; ground.position.set(center.x, bounds.min.y - .025, center.z); ground.receiveShadow = true; scene.add(ground);
        disposers.push(() => { ground.geometry.dispose(); ground.material.dispose(); });
        const selectionMaterial = new T.MeshBasicMaterial({ color: 0x659764, transparent: true, opacity: .3, side: T.DoubleSide, depthWrite: false, clippingPlanes: planes });
        let selection: Three.Mesh | undefined;
        disposers.push(() => { selection?.geometry.dispose(); selectionMaterial.dispose(); });
        update.current = () => {
          const { controls: c, plan: p, selected: id } = live.current;
          cutX.constant = c.cutX === 100 ? 10000 : b.x + b.w * c.cutX / 100;
          cutZ.constant = c.cutZ === 100 ? 10000 : b.z + b.d * c.cutZ / 100;
          bottom.constant = c.isolate ? -c.floor : 10000; top.constant = c.isolate ? c.floor + 5.99 : 10000;
          for (const object of objects) {
            object.visible = c.roofs || !object.userData.roof;
            object.position.y = c.explode && !c.isolate ? Math.max(0, object.userData.floor) * 9 : 0;
          }
          renderer.shadowMap.needsUpdate = true;
          if (selection) { scene.remove(selection); selection.geometry.dispose(); selection = undefined; }
          const room = p.rooms.find(r => r.id === id);
          if (room) {
            const shape = new T.Shape(); room.polygon.forEach((v, i) => { if (i) shape.lineTo(v.x, -v.z); else shape.moveTo(v.x, -v.z); });
            for (const h of room.holes) {
              const hole = new T.Path(); hole.moveTo(h.x, -h.z); hole.lineTo(h.x + h.w + 1, -h.z); hole.lineTo(h.x + h.w + 1, -h.z - h.d - 1); hole.lineTo(h.x, -h.z - h.d - 1); hole.closePath(); shape.holes.push(hole);
            }
            selection = new T.Mesh(new T.ShapeGeometry(shape), selectionMaterial); selection.rotation.x = -Math.PI / 2;
            selection.position.y = room.floorY + 1.04 + (c.explode && !c.isolate ? Math.max(0, room.floorY / 6) * 9 : 0); scene.add(selection);
          }
        };
        update.current();
        let resizeFrame = 0;
        const resize = () => {
          if (disposed || !el.clientWidth || !el.clientHeight) return;
          camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(el.clientWidth, el.clientHeight, false);
        };
        const observer = new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(resize); });
        observer.observe(el); resize(); fit();
        disposers.push(() => { observer.disconnect(); cancelAnimationFrame(resizeFrame); });
        const raycaster = new T.Raycaster(), pointer = new T.Vector2(); let down = { x: 0, y: 0, button: 0 };
        const pointerDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY, button: event.button }; };
        const pointerUp = (event: PointerEvent) => {
          if (down.button !== 0 || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
          const rect = renderer.domElement.getBoundingClientRect(); pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, camera);
          for (const hit of raycaster.intersectObjects(objects.filter(o => o.visible))) {
            const point = hit.point;
            if (point.x > cutX.constant || point.z > cutZ.constant || point.y < -bottom.constant || point.y > top.constant) continue;
            const y = point.y - hit.object.position.y;
            const room = [...live.current.plan.rooms].sort((a, b) => b.floorY - a.floorY).find(r => y >= r.floorY && y <= r.ceilingY && insidePolygon(point.x, point.z, r.polygon)
              && !r.holes.some(h => point.x >= h.x && point.x < h.x + h.w + 1 && point.z >= h.z && point.z < h.z + h.d + 1));
            if (room) { live.current.onSelect(room.id); break; }
          }
        };
        const contextLost = (event: Event) => { if (!disposed) { event.preventDefault(); setError('The graphics context was lost. Floor plans and schematic exports remain available.'); } };
        renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointerup', pointerUp); renderer.domElement.addEventListener('webglcontextlost', contextLost);
        disposers.push(() => { renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointerup', pointerUp); renderer.domElement.removeEventListener('webglcontextlost', contextLost); });
        renderer.setAnimationLoop(() => { if (!disposed) { orbit.update(); renderer.render(scene, camera); } });
      } catch (cause) {
        cleanup(); if (!disposed) setError(cause instanceof Error ? cause.message : '3D could not start in this browser. Floor plans and exports remain available.');
      }
    }
    setError(''); void init(); return () => { disposed = true; cleanup(); };
  }, [meshes, plan]);
  useEffect(() => { update.current?.(); }, [controls, selected]);
  return <div className="three-stage" ref={host}>
    {!error && <fieldset aria-label="3D camera views" style={{ position: 'absolute', top: 14, left: 14, zIndex: 2, display: 'flex', flexWrap:'wrap',right:14,gap: 6, border: 0, margin: 0, padding: 0 }}>
      {(['perspective', 'front', 'top'] as const).map(view => <button key={view} className="button button-outline" style={{ padding: '7px 11px', fontSize: 12, background: 'rgba(248,246,238,.94)' }} onClick={() => preset.current?.(view)}>{view === 'perspective' ? 'Fit model' : view === 'front' ? 'Front' : 'Top'}</button>)}
      <button className="button button-outline" style={{padding:'7px 11px',fontSize:12,background:'rgba(248,246,238,.94)'}} disabled={!meshes.length} onClick={exportMesh} title="Export the complete architectural model, including hidden roofs and floors">Export 3D · GLB</button>
    </fieldset>}
    {exportError&&<output style={{position:'absolute',bottom:12,left:12,zIndex:3}}>{exportError}</output>}
    {error && <div className="webgl-fallback" role="status"><strong>Plans are ready. 3D is unavailable.</strong><p>{error}</p></div>}
  </div>;
}
