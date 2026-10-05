"""Freeze identical displayed-time frames without a Node dependency install."""
import hashlib,json,re,subprocess,pathlib,concurrent.futures
ROOT=pathlib.Path(__file__).resolve().parent
bank_bytes=(ROOT/'qa/recognition-question-bank-v2.json').read_bytes()
bank=json.loads(bank_bytes)
manifest=json.loads((ROOT/'manifest.json').read_text())
samples={s['id']:s for s in manifest['scenarios']}
dest=ROOT/'qa/model-frame-packs';dest.mkdir(exist_ok=True)
def freeze(c):
 sample=samples[c['scenario_id']];video=ROOT/sample['video']
 probe=json.loads(subprocess.check_output(['/opt/homebrew/bin/ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=avg_frame_rate,r_frame_rate','-of','json',str(video)]))['streams'][0]
 rate=lambda v:float(v.split('/')[0])/max(1,float(v.split('/')[1]))
 actual=rate(probe['avg_frame_rate']);nominal=rate(probe['r_frame_rate'])
 fps=max(25,min(60,actual or 25));end=c['timestamp_s'];start=max(0,end-8)
 seek=max(0,start-(8 if actual<1 or abs(actual-nominal)>actual*.02 else 0));offset=start-seek
 count=max(1,round((end-start)*fps));latest=count-1;recent=max(0,latest-round(fps*.8));older=6
 old=[round(i*max(0,recent-1)/(older-1)) for i in range(older)]
 indices=sorted(set(old+[recent,round((recent+latest)/2),latest]))
 select='+'.join('eq(round((t-%s)*%s)\\,%s)'%(offset,fps,i) for i in indices)
 filt="fps=fps=%s:round=up,select='%s',showinfo,scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease"%(fps,select)
 result=subprocess.run(['/opt/homebrew/bin/ffmpeg','-hide_banner','-loglevel','info','-ss',str(seek),'-i',str(video),'-t',str(end-seek+.5),'-vf',filt,'-fps_mode','passthrough','-frames:v',str(len(indices)),'-f','image2pipe','-vcodec','mjpeg','-q:v','2','pipe:1'],capture_output=True,timeout=90,check=True)
 times=[seek+float(t)for t in re.findall(rb'\bpts_time:([\d.eE+-]+)',result.stderr)]
 images=re.findall(rb'\xff\xd8.*?\xff\xd9',result.stdout,re.S)
 if len(times)!=len(images)or not images:raise RuntimeError('Bad frozen pack '+c['id'])
 frames=[]
 for i,(timestamp,img)in enumerate(zip(times,images)):
  if timestamp>end+.05:continue
  file='qa/model-frame-packs/'+c['id']+'-'+str(i)+'.jpg';(ROOT/file).write_bytes(img)
  frames.append({'file':file,'sha256':hashlib.sha256(img).hexdigest(),'timestamp_s':timestamp})
 if not frames:raise RuntimeError('No current frames '+c['id'])
 print(json.dumps({'case_id':c['id'],'frames':len(frames),'latest':frames[-1]['timestamp_s']}),flush=True)
 return {'id':c['id'],'scenario_id':c['scenario_id'],'current_s':end,'source_sha256':sample['sha256'],'frames':frames}
with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:rows=list(pool.map(freeze,bank['cases']))
pack={'version':1,'bank':'qa/recognition-question-bank-v2.json','bank_sha256':hashlib.sha256(bank_bytes).hexdigest(),'samples':9,'window_seconds':8,'latest_motion_seconds':.8,'description':'Identical displayed-time JPEG inputs for every model, maximum1280px; no future frames. Temporal context plus three recent motion samples. Expected answers never passed to model.','cases':rows}
(ROOT/'qa/frozen-frame-pack.json').write_text(json.dumps(pack,indent=2))
