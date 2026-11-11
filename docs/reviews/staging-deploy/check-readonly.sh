#!/bin/sh
# Run from an already approved tooling location outside the checked directories.
# No downloads, installs, mounts outside the child namespace, chmod or temp files.
set -eu
if [ ! -x /usr/bin/bwrap ]; then
    printf '%s\n' 'STOP: bubblewrap unavailable; no target check performed.' >&2
    exit 1
fi
tool_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
exec /usr/bin/bwrap --ro-bind / / --unshare-net --die-with-parent --remount-ro /proc/sys/fs/binfmt_misc -- \
    /usr/bin/python3 -I -B -S "$tool_dir/pv-staging-release.py" --check "$@"
