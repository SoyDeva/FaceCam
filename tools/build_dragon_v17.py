#!/usr/bin/env python3
import argparse, hashlib, json, math, struct
from pathlib import Path
from collections import deque
import numpy as np

JSON_CHUNK=0x4E4F534A; BIN_CHUNK=0x004E4942
DTYPE={5126:np.dtype('<f4'),5125:np.dtype('<u4'),5123:np.dtype('<u2'),5122:np.dtype('<i2'),5121:np.dtype('u1')}; NCOMP={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}
def read_glb(path):
 raw=Path(path).read_bytes(); magic,ver,total=struct.unpack_from('<4sII',raw,0)
 if magic!=b'glTF' or ver!=2 or total!=len(raw): raise ValueError('bad glb')
 off=12; doc=binb=None
 while off<len(raw):
  ln,ct=struct.unpack_from('<II',raw,off); data=raw[off+8:off+8+ln]
  if ct==JSON_CHUNK: doc=json.loads(data.rstrip(b' \t\r\n\x00'))
  elif ct==BIN_CHUNK: binb=bytearray(data)
  off+=8+ln
 return doc,binb
def accessor_view(doc,b,i):
 a=doc['accessors'][i]; v=doc['bufferViews'][a['bufferView']]; dt=DTYPE[a['componentType']]; c=NCOMP[a['type']]
 off=v.get('byteOffset',0)+a.get('byteOffset',0); stride=v.get('byteStride',dt.itemsize*c)
 if stride!=dt.itemsize*c: raise ValueError('stride')
 return np.ndarray((a['count'],c),dtype=dt,buffer=b,offset=off)
def append_indices(doc,b,idx,indices):
 arr=np.asarray(indices,dtype=np.uint32).reshape(-1); pad=(-len(b))%4
 if pad:b.extend(b'\0'*pad)
 off=len(b); payload=arr.astype('<u4',copy=False).tobytes(); b.extend(payload)
 doc['bufferViews'].append({'buffer':0,'byteOffset':off,'byteLength':len(payload),'target':34963})
 a=doc['accessors'][idx]; a.update({'bufferView':len(doc['bufferViews'])-1,'byteOffset':0,'count':int(arr.size),'componentType':5125,'type':'SCALAR','min':[int(arr.min())] if arr.size else [0],'max':[int(arr.max())] if arr.size else [0]})
def append_vec3(doc,b,arr):
 arr=np.asarray(arr,dtype='<f4').reshape(-1,3); pad=(-len(b))%4
 if pad:b.extend(b'\0'*pad)
 off=len(b); payload=arr.tobytes(); b.extend(payload)
 doc['bufferViews'].append({'buffer':0,'byteOffset':off,'byteLength':len(payload),'target':34962})
 doc['accessors'].append({'bufferView':len(doc['bufferViews'])-1,'byteOffset':0,'componentType':5126,'count':len(arr),'type':'VEC3','min':arr.min(0).astype(float).tolist(),'max':arr.max(0).astype(float).tolist()})
 return len(doc['accessors'])-1
def write_glb(doc,b,path):
 doc['buffers'][0]['byteLength']=len(b); jb=json.dumps(doc,separators=(',',':'),ensure_ascii=False).encode(); jb+=b' '*((-len(jb))%4); bb=bytes(b); bb+=b'\0'*((-len(bb))%4)
 total=12+8+len(jb)+8+len(bb); out=struct.pack('<4sII',b'glTF',2,total)+struct.pack('<II',len(jb),JSON_CHUNK)+jb+struct.pack('<II',len(bb),BIN_CHUNK)+bb; Path(path).write_bytes(out)
def normals(pos,faces):
 n=np.zeros_like(pos,dtype=np.float64); tri=pos[faces]; fn=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0])
 for k in range(3): np.add.at(n,faces[:,k],fn)
 l=np.linalg.norm(n,axis=1); good=l>1e-12; n[good]/=l[good,None]; return n.astype(np.float32)

def main():
 ap=argparse.ArgumentParser(); ap.add_argument('--v13',required=True); ap.add_argument('--out',required=True)
 ap.add_argument('--hinge-y',type=float,default=.32); ap.add_argument('--hinge-z',type=float,default=.20); ap.add_argument('--jaw-angle-deg',type=float,default=35.0)
 ap.add_argument('--cavity-max-z',type=float,default=.36); ap.add_argument('--cavity-max-abs-x',type=float,default=.205); ap.add_argument('--cavity-max-y',type=float,default=.445); args=ap.parse_args()
 doc,b=read_glb(args.v13)
 neutral=accessor_view(doc,b,8).copy(); base_norm=accessor_view(doc,b,9).copy(); head=accessor_view(doc,b,3).reshape(-1).astype(np.uint32).reshape(-1,3); mouth=accessor_view(doc,b,11).reshape(-1).astype(np.uint32).reshape(-1,3)
 open_base=accessor_view(doc,b,12).copy(); open_delta=accessor_view(doc,b,16).copy(); open_end=open_base+open_delta; open_faces=accessor_view(doc,b,15).reshape(-1).astype(np.uint32).reshape(-1,3)
 eye_hashes=[hashlib.sha256(accessor_view(doc,b,i).tobytes()).hexdigest() for i in (4,5,6,7)]
 hv=set(np.unique(head).tolist()); mv=np.unique(mouth); seam=np.array(sorted(set(mv.tolist()) & hv),dtype=np.int64)
 adj={int(v):set() for v in mv}
 for f in mouth:
  a,c,d=map(int,f); adj[a].update((c,d)); adj[c].update((a,d)); adj[d].update((a,c))
 rings={int(v):999 for v in mv}; q=deque()
 for v in seam:rings[int(v)]=0;q.append(int(v))
 while q:
  v=q.popleft(); nd=rings[v]+1
  for u in adj[v]:
   if nd<rings[u]:rings[u]=nd;q.append(u)
 pts=neutral[mv]; theta=math.radians(args.jaw_angle_deg); c=math.cos(theta); s=math.sin(theta)
 yy=pts[:,1]-args.hinge_y; zz=pts[:,2]-args.hinge_z
 rotated=np.stack([pts[:,0], args.hinge_y+c*yy-s*zz, args.hinge_z+s*yy+c*zz],axis=1).astype(np.float32)
 ring=np.array([rings[int(v)] for v in mv],dtype=np.float32); seam_w=np.clip(ring/6.0,0,1)
 y=pts[:,1]; t=np.clip((.43-y)/(.43-.31),0,1); y_w=t*t*(3-2*t)
 z=pts[:,2]; z_w=np.clip((z+.05)/.22,.25,1.0); weight=seam_w*y_w*z_w
 jaw=np.zeros_like(neutral,dtype=np.float32); jaw[mv]=(rotated-pts)*weight[:,None]; jaw[seam]=0
 full_faces=np.vstack([head,mouth]); morphed=neutral+jaw; new_norm=normals(morphed,full_faces); normal_delta=new_norm-base_norm; normal_delta[seam]=0
 jaw_pos_accessor=append_vec3(doc,b,jaw); jaw_norm_accessor=append_vec3(doc,b,normal_delta)
 mesh1=doc['meshes'][1]; mesh1['weights']=[0]; mesh1.setdefault('extras',{})['targetNames']=['jawOpen']; mesh1['extras'].update({'faceCamRole':'neutral-mouth','faceCamJawTransfer':'hinge-continuous','faceCamSeamPinnedVertices':int(len(seam)),'faceCamHingeY':args.hinge_y,'faceCamHingeZ':args.hinge_z,'faceCamJawAngleDeg':args.jaw_angle_deg}); mesh1['primitives'][0]['targets']=[{'POSITION':jaw_pos_accessor,'NORMAL':jaw_norm_accessor}]; mesh1['name']='FaceCam_NeutralJaw_v17'
 tri=open_end[open_faces]; cen=tri.mean(1); cavity=(cen[:,2]<args.cavity_max_z)&(np.abs(cen[:,0])<args.cavity_max_abs_x)&(cen[:,1]<args.cavity_max_y); cavity_faces=open_faces[cavity]; append_indices(doc,b,15,cavity_faces)
 mesh2=doc['meshes'][2]; mesh2['name']='FaceCam_OralCavity_v17'; mesh2.setdefault('extras',{}).update({'faceCamRole':'open-mouth','faceCamCavityOnly':True,'faceCamCavityMaxZ':args.cavity_max_z,'faceCamCavityMaxAbsX':args.cavity_max_abs_x,'faceCamCavityMaxY':args.cavity_max_y})
 if len(doc.get('materials',[]))>1: doc['materials'][1]['doubleSided']=True
 doc.setdefault('asset',{}).setdefault('extras',{}).update({'faceCamRigVersion':17,'faceCamMouthOnlyRevision':'continuous-neutral-hinge-jaw-plus-cavity','faceCamEyesFrozenFrom':'v13','faceCamEyeAccessorHashes':eye_hashes})
 write_glb(doc,b,args.out)
 d2,b2=read_glb(args.out); after=[hashlib.sha256(accessor_view(d2,b2,i).tobytes()).hexdigest() for i in (4,5,6,7)]; assert after==eye_hashes
 print('neutral mouth faces',len(mouth),'seam pinned',len(seam),'jaw nonzero',int((np.linalg.norm(jaw,axis=1)>1e-5).sum())); print('jaw delta max',float(np.linalg.norm(jaw,axis=1).max()),'cavity faces',len(cavity_faces)); print('eyes unchanged',after==eye_hashes); print('sha256',hashlib.sha256(Path(args.out).read_bytes()).hexdigest())
if __name__=='__main__':main()
