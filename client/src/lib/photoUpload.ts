export async function uploadProductPhoto(file: File): Promise<string> {
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo.');
 if(file.size>10*1024*1024) throw new Error('Choose a photo smaller than 10 MB.');
 const bitmap=await createImageBitmap(file).catch(()=>{throw new Error('This photo could not be opened. Try a different photo.');});
 let blob: Blob | null;
 try {
  const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Photo preparation is unavailable. Try another browser.');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',0.8));
 } finally {bitmap.close();}
 if(!blob||blob.size>1024*1024)throw new Error('This photo is too large after resizing. Choose a smaller photo.');
 const response=await fetch('/api/farmer/photos',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'image/jpeg'},body:blob,signal:AbortSignal.timeout(30000)});
 const result=await response.json().catch(()=>null);
 if(!response.ok)throw new Error(result?.error?.message||'Upload failed. Please try again.');
 return result.image;
}
