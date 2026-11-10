const status=document.querySelector('#downloadStatus');
try{
 const response=await fetch('./downloads/manifest.json');if(!response.ok)throw Error('No package manifest');const manifest=await response.json();
 for(const kind of ['source','web']){
  const item=manifest.packages.find(p=>p.kind===kind);if(!item||!/^serre-chevalier-(source|web)-v[\d.]+\.zip$/.test(item.file)||!Number.isFinite(item.bytes))throw Error('Invalid package manifest');
  const link=document.querySelector(`[data-package="${kind}"]`);link.href='./downloads/'+item.file;link.download=item.file;link.removeAttribute('aria-disabled');link.textContent=kind==='source'?'Download source ZIP ↓':'Download web build ↓';document.querySelector(`[data-meta="${kind}"]`).textContent=`${(item.bytes/1048576).toFixed(1)} MiB · ZIP · Version ${manifest.version}`;
 }
 document.querySelector('#checksums').hidden=false;
}catch{
 for(const link of document.querySelectorAll('[data-package]')){link.textContent='Packages not built yet';link.removeAttribute('href');link.removeAttribute('download');link.setAttribute('aria-disabled','true');}
 status.textContent='In a copied source project, run npm run export to create the downloadable ZIPs. The game itself is ready to play.';
}
