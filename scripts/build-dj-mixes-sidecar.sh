#!/usr/bin/env bash
set -euo pipefail

app_dir="$(cd "$(dirname "$0")/.." && pwd)"
runtime_dir="$app_dir/dj-mixes-runtime"
venv_dir="$app_dir/.dj-mixes-build-venv"

python_bin="${PYTHON_BIN:-python3}"
if [[ ! -x "$venv_dir/bin/python" ]]; then
  "$python_bin" -m venv "$venv_dir"
fi
"$venv_dir/bin/python" -m pip install --disable-pip-version-check -r "$runtime_dir/requirements-build.txt"

case "$(uname -m)" in
  arm64) rust_target="aarch64-apple-darwin" ;;
  x86_64) rust_target="x86_64-apple-darwin" ;;
  *) echo "Unsupported macOS architecture: $(uname -m)" >&2; exit 1 ;;
esac

"$venv_dir/bin/pyinstaller" \
  --clean \
  --noconfirm \
  --onefile \
  --name dj-mixes-server \
  --distpath "$runtime_dir/dist" \
  --workpath "$runtime_dir/build" \
  --specpath "$runtime_dir/build" \
  --paths "$runtime_dir" \
  "$runtime_dir/mixes_server.py"

install -m 755 \
  "$runtime_dir/dist/dj-mixes-server" \
  "$app_dir/src-tauri/binaries/dj-mixes-server-$rust_target"

echo "Built src-tauri/binaries/dj-mixes-server-$rust_target"
