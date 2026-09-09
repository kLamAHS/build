'use client';
import { useEffect, useRef, useState } from 'react';
import type * as Three from 'three';
import { MATERIALS, insidePolygon, type Plan } from '@/lib/model';
import type { MeshData } from '@/lib/voxels';

export type ViewControls={roofs:boolean;isolate:boolean;explode:boolean;cutX:number;cutZ:number;floor:number};
type Props={plan:Plan;meshes:MeshData[];controls:ViewControls;selected?:string;onSelect:(id:string)=>void};
export default function BuildingViewer({plan,meshes,controls,selected,onSelect}:Props){
  const host=useRef<HTMLDivElement>(null),live=useRef({plan,controls,selected,onSelect});live.current={plan,controls,selected,onSelect};
  const update=useRef<(()=>void)|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    const el=host.current!;let disposed=false,cleanup=()=>{};
    async function init(){
      try{
        if(new URLSearchParams(window.location.search).get('graphics')==='off')throw new Error('Plan-only compatibility mode');
        const T=await import('three'),{OrbitControls}=await import('three/addons/controls/OrbitControls.js');if(disposed)return;
        const renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
        renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.75));renderer.localClippingEnabled=true;renderer.setClearColor('#eeeadd',1);el.appendChild(renderer.domElement);
        renderer.domElement.setAttribute('aria-label','3D building cutaway. Drag to orbit, right-drag to pan, scroll to zoom.');
        const scene=new T.Scene(),camera=new T.PerspectiveCamera(38,1,.5,4000);
        const b=plan.bounds,center=new T.Vector3(b.x+b.w/2,Math.max(4,plan.maxY*.25),b.z+b.d/2),span=Math.max(b.w,b.d);
        camera.position.set(center.x+span*.85,center.y+span*.75,center.z+span*1.1);
        const orbit=new OrbitControls(camera,renderer.domElement);orbit.target.copy(center);orbit.enableDamping=true;orbit.dampingFactor=.08;orbit.minDistance=8;orbit.maxDistance=span*4;orbit.maxPolarAngle=Math.PI*.49;
        scene.add(new T.HemisphereLight(0xfff4de,0x69766a,2.4));const sun=new T.DirectionalLight(0xfff5df,2.5);sun.position.set(-100,180,70);scene.add(sun);
        const cutX=new T.Plane(new T.Vector3(-1,0,0),10000),cutZ=new T.Plane(new T.Vector3(0,0,-1),10000),bottom=new T.Plane(new T.Vector3(0,1,0),10000),top=new T.Plane(new T.Vector3(0,-1,0),10000);
        const materials=new Map<number,Three.MeshStandardMaterial>(),objects:Three.Mesh[]=[];
        for(const data of meshes){
          let mat=materials.get(data.material);if(!mat){mat=new T.MeshStandardMaterial({color:MATERIALS[data.material].color,roughness:.91,metalness:0,side:T.DoubleSide,clippingPlanes:[cutX,cutZ,bottom,top]});materials.set(data.material,mat);}
          const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(data.positions,3));geometry.setAttribute('normal',new T.BufferAttribute(data.normals,3));geometry.setIndex(new T.BufferAttribute(data.indices,1));geometry.computeBoundingSphere();const mesh=new T.Mesh(geometry,mat);mesh.userData={floor:data.floor,roof:data.roof};scene.add(mesh);objects.push(mesh);
        }
        const grid=new T.GridHelper(Math.ceil(span/16)*16,Math.ceil(span/16),0xb6b39d,0xd5d1bd);grid.position.set(center.x,plan.minY-1.05,center.z);scene.add(grid);
        const selectionMaterial=new T.MeshBasicMaterial({color:0x659764,transparent:true,opacity:.32,side:T.DoubleSide,depthWrite:false,clippingPlanes:[cutX,cutZ,bottom,top]});
        let selection:Three.Mesh|undefined;
        const apply=()=>{
          const {controls:c,plan:p,selected:id}=live.current;
          cutX.constant=c.cutX===100?10000:b.x+b.w*c.cutX/100;cutZ.constant=c.cutZ===100?10000:b.z+b.d*c.cutZ/100;
          bottom.constant=c.isolate?-c.floor:10000;top.constant=c.isolate?c.floor+5.99:10000;
          for(const object of objects){object.visible=c.roofs||!object.userData.roof;object.position.y=c.explode&&!c.isolate?Math.max(0,object.userData.floor)*9:0;}
          if(selection){scene.remove(selection);selection.geometry.dispose();selection=undefined;}
          const room=p.rooms.find(r=>r.id===id);
          if(room){const shape=new T.Shape();room.polygon.forEach((v,i)=>{if(i)shape.lineTo(v.x,-v.z);else shape.moveTo(v.x,-v.z);});for(const h of room.holes){const hole=new T.Path();hole.moveTo(h.x,-h.z);hole.lineTo(h.x+h.w+1,-h.z);hole.lineTo(h.x+h.w+1,-h.z-h.d-1);hole.lineTo(h.x,-h.z-h.d-1);hole.closePath();shape.holes.push(hole);}const geometry=new T.ShapeGeometry(shape);selection=new T.Mesh(geometry,selectionMaterial);selection.rotation.x=-Math.PI/2;selection.position.y=room.floorY+1.04+(c.explode&&!c.isolate?Math.max(0,room.floorY/6)*9:0);scene.add(selection);}
        };
        update.current=apply;apply();
        let resizeFrame=0;
        const resize=()=>{if(disposed||!el.clientWidth||!el.clientHeight)return;camera.aspect=el.clientWidth/el.clientHeight;camera.updateProjectionMatrix();renderer.setSize(el.clientWidth,el.clientHeight,false);};
        const observer=new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(resize);});observer.observe(el);resize();
        const raycaster=new T.Raycaster(),pointer=new T.Vector2();let down={x:0,y:0};
        const pointerDown=(e:PointerEvent)=>{down={x:e.clientX,y:e.clientY};};
        const pointerUp=(e:PointerEvent)=>{if(Math.hypot(e.clientX-down.x,e.clientY-down.y)>4)return;const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);const hits=raycaster.intersectObjects(objects.filter(o=>o.visible));for(const hit of hits){const point=hit.point;if(point.x>cutX.constant||point.z>cutZ.constant||point.y<-bottom.constant||point.y>top.constant)continue;const originalY=point.y-hit.object.position.y;const r=[...live.current.plan.rooms].sort((a,b)=>b.floorY-a.floorY).find(r=>originalY>=r.floorY&&originalY<=r.ceilingY&&insidePolygon(point.x,point.z,r.polygon)&&!r.holes.some(h=>point.x>=h.x&&point.x<h.x+h.w+1&&point.z>=h.z&&point.z<h.z+h.d+1));if(r){live.current.onSelect(r.id);break;}}};
        renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointerup',pointerUp);
        const contextLost=(e:Event)=>{if(disposed)return;e.preventDefault();setError('The 3D graphics context was lost. Floor plans and block layers remain available.');};
        renderer.domElement.addEventListener('webglcontextlost',contextLost);
        renderer.setAnimationLoop(()=>{if(!disposed){orbit.update();renderer.render(scene,camera);}});
        cleanup=()=>{update.current=null;observer.disconnect();cancelAnimationFrame(resizeFrame);renderer.domElement.removeEventListener('webglcontextlost',contextLost);renderer.setAnimationLoop(null);orbit.dispose();for(const o of objects)o.geometry.dispose();for(const m of materials.values())m.dispose();selection?.geometry.dispose();selectionMaterial.dispose();grid.geometry.dispose();(grid.material as Three.Material).dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();};
      }catch{if(!disposed)setError('3D requires WebGL 2, which is unavailable in this browser. You can still explore every floor and export exact block layers.');}
    }
    setError('');void init();return()=>{disposed=true;cleanup();};
  },[meshes,plan]);
  useEffect(()=>{update.current?.();},[controls,selected]);
  return <div className="three-stage" ref={host}>{error&&<div className="webgl-fallback" role="status"><strong>Plans are ready. 3D is unavailable.</strong><p>{error}</p></div>}</div>;
}
