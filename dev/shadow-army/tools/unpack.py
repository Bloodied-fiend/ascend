import zipfile,sys,os,pathlib
src,dst=pathlib.Path(sys.argv[1]),pathlib.Path(sys.argv[2])
from PIL import Image
for z in sorted(src.glob("*.zip")):
    out=dst/z.stem.replace(" ","_"); out.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(z) as zf:
        for m in zf.infolist():
            if m.is_dir(): continue
            target=(out/m.filename).resolve()
            if not str(target).startswith(str(out.resolve())+os.sep): print("  SKIP unsafe path",m.filename); continue
            ext=target.suffix.lower()
            if ext not in (".png",".txt",".gif"): print("  SKIP non-image",m.filename); continue
            target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(zf.read(m))
    pngs=sorted(out.rglob("*.png")); bad=[]
    for p in pngs:
        try: Image.open(p).verify()
        except Exception: bad.append(p.name)
    print(z.name,"->",len(pngs),"png", "BAD:"+",".join(bad) if bad else "all valid")
    for p in pngs: 
        im=Image.open(p); print("   ",p.relative_to(out),im.size)
