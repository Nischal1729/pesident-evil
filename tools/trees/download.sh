#!/usr/bin/env bash
# Downloads the CC0 source textures used by tools/trees/build_atlas.py into tools/trees/_downloads/ (gitignored).
#   Poly Haven (https://polyhaven.com, CC0): leaf / blade / bark textures from plant and tree models
#   ambientCG  (https://ambientcg.com, CC0): Grass005 lawn set
# Then: python3 tools/trees/build_atlas.py   (needs pillow, numpy, scipy)
set -euo pipefail
cd "$(dirname "$0")"
DL=_downloads
mkdir -p "$DL/ph" "$DL/acg"

ph() { # ph <asset> <map> [res]   → _downloads/ph/<asset>/<map>_<res>.jpg
  local asset=$1 map=$2 res=${3:-1k}
  mkdir -p "$DL/ph/$asset"
  local out="$DL/ph/$asset/${map}_${res}.jpg"
  [ -f "$out" ] && return
  local url
  url=$(curl -s "https://api.polyhaven.com/files/$asset" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['$map']['$res']['jpg']['url'])")
  curl -sL -o "$out" "$url"
  echo "$out"
}

for m in leaves_diff leaves_alpha; do
  ph jacaranda_tree $m; ph tree_small_02 $m; ph island_tree_01 $m; ph pachira_aquatica_01 $m
done
for a in grass_bermuda_01 grass_medium_02 shrub_04 fern_02; do ph $a Diffuse; ph $a Alpha; done
for a in chinese_hackberry_bark palm_tree_bark japanese_sycamore; do ph $a Diffuse; ph $a nor_gl; done

if [ ! -f "$DL/acg/Grass005/Grass005_1K-JPG_Color.jpg" ]; then
  curl -sL -o "$DL/acg/Grass005_1K-JPG.zip" "https://ambientcg.com/get?file=Grass005_1K-JPG.zip"
  mkdir -p "$DL/acg/Grass005" && (cd "$DL/acg/Grass005" && unzip -o -q ../Grass005_1K-JPG.zip)
fi
echo "done"
