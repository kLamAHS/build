import { MATERIALS } from './model.ts';
import type { MeshData } from './voxels.ts';

/** Binary glTF 2.0, built from the exact same uncut meshes as the 3D viewer. No exporter dependency. */
export function buildingGlb(meshes:MeshData[],name='Keepwright building'):Uint8Array {
  const chunks:Uint8Array[]=[],views:Record<string,unknown>[]=[],accessors:Record<string,unknown>[]=[],materials:Record<string,unknown>[]=[],gltfMeshes:Record<string,unknown>[]=[],nodes:Record<string,unknown>[]=[];
  let offset=0;
  const append=(data:Float32Array|Uint32Array,target:number)=>{
    const bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength),index=views.length;
    views.push({buffer:0,byteOffset:offset,byteLength:bytes.length,target});chunks.push(bytes);offset+=bytes.length;return index;
  };
  const color=(hex:string)=>[1,3,5].map(i=>{const v=parseInt(hex.slice(i,i+2),16)/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
  const materialIds=new Map<string,number>();
  for(const mesh of meshes){
    if(!mesh.indices.length)continue;
    if(mesh.positions.length%3||mesh.normals.length!==mesh.positions.length||mesh.indices.length%3)throw new Error('Invalid triangle mesh.');
    const n=mesh.positions.length/3,min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<mesh.positions.length;i++){const p=mesh.positions[i];if(!Number.isFinite(p)||!Number.isFinite(mesh.normals[i]))throw new Error('Non-finite mesh coordinate.');min[i%3]=Math.min(min[i%3],p);max[i%3]=Math.max(max[i%3],p);}
    for(const i of mesh.indices)if(i>=n)throw new Error('Mesh index is outside its vertex buffer.');
    const pos=accessors.length;accessors.push({bufferView:append(mesh.positions,34962),componentType:5126,count:n,type:'VEC3',min,max});
    const normal=accessors.length;accessors.push({bufferView:append(mesh.normals,34962),componentType:5126,count:n,type:'VEC3'});
    const index=accessors.length;accessors.push({bufferView:append(mesh.indices,34963),componentType:5125,count:mesh.indices.length,type:'SCALAR'});
    const hex=mesh.color??MATERIALS[mesh.material].color,key=`${mesh.material}/${hex}/${mesh.emissive??''}`;
    let material=materialIds.get(key);
    if(material===undefined){
      material=materials.length;materialIds.set(key,material);
      materials.push({name:`${MATERIALS[mesh.material].name} ${hex}`,pbrMetallicRoughness:{baseColorFactor:[...color(hex),1],metallicFactor:0,roughnessFactor:mesh.material===4?.32:.9},doubleSided:true,...(mesh.emissive?{emissiveFactor:color(mesh.emissive)}:{})});
    }
    const mi=gltfMeshes.length;gltfMeshes.push({primitives:[{attributes:{POSITION:pos,NORMAL:normal},indices:index,material,mode:4}]});
    nodes.push({name:`${mesh.roof?'Roof':'Storey'} ${mesh.floor} / ${MATERIALS[mesh.material].name}`,mesh:mi,extras:{roof:mesh.roof,floor:mesh.floor}});
  }
  if(!nodes.length)throw new Error('There is no geometry to export.');
  const root={asset:{version:'2.0',generator:'Keepwright architectural compiler 2'},scene:0,scenes:[{name,nodes:nodes.map((_,i)=>i)}],nodes,meshes:gltfMeshes,materials,buffers:[{byteLength:offset}],bufferViews:views,accessors,extras:{units:'one Minecraft block',coordinates:'Y up; original plan coordinates',fullBuilding:true}};
  const text=new TextEncoder().encode(JSON.stringify(root)),jsonLength=(text.length+3)&~3,binLength=(offset+3)&~3,total=12+8+jsonLength+8+binLength;
  const out=new Uint8Array(total),view=new DataView(out.buffer);
  view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,total,true);
  view.setUint32(12,jsonLength,true);view.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+jsonLength);out.set(text,20);
  const bin=20+jsonLength;view.setUint32(bin,binLength,true);view.setUint32(bin+4,0x004e4942,true);
  let at=bin+8;for(const c of chunks){out.set(c,at);at+=c.length;}
  return out;
}
