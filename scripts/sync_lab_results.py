#!/usr/bin/env python3
import shutil, pathlib
SRC = pathlib.Path.home() / "AppData/Local/hermes/scripts/backtest_lab"
RES = SRC / "results"
DST = pathlib.Path(__file__).resolve().parents[1] / "public/lab"
def main():
    DST.mkdir(parents=True, exist_ok=True)
    n=0
    for p in ["report.md","equity_curves.png","correlation.json"]:
        s=RES/p
        if s.exists(): shutil.copy2(s, DST/p); n+=1
    s=SRC/"hypotheses.json"
    if s.exists(): shutil.copy2(s, DST/"hypotheses.json"); n+=1
    for f in RES.glob("*_metrics.json"):
        shutil.copy2(f, DST/f.name); n+=1
    for f in RES.glob("*_mc.json"):
        shutil.copy2(f, DST/f.name); n+=1
    print(f"synced {n} files -> {DST}")
    for x in sorted(DST.iterdir()): print(" ",x.name)
if __name__=="__main__": main()
