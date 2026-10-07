#!/bin/bash
# Trusted image preparation only. Never receives participant source or secrets.
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo 'Run the trusted image builder as root on disposable Linux.' >&2; exit 1; fi
out=$(realpath "$1")
mkdir -p "$out"
root=$(mktemp -d /tmp/judge-image.XXXXXXXX)
cleanup() { mountpoint -q "$root" && umount "$root" || true; rmdir "$root"; }
trap cleanup EXIT
truncate -s 2G "$out/root.raw"
mkfs.ext4 -q -F "$out/root.raw"
mount -o loop "$out/root.raw" "$root"
# Frozen Debian catalogue; all downloaded packages remain signature verified.
debootstrap --variant=minbase --include=linux-image-amd64,initramfs-tools,util-linux,iproute2,kmod,ca-certificates --keyring=/usr/share/keyrings/debian-archive-keyring.gpg bookworm "$root" https://snapshot.debian.org/archive/debian/20261001T000000Z/
mkdir -p "$root/work" "$root/opt/judge" "$root/run"
# Organizer-prepared Node runtime. Verify official checksum before installation.
node_version=v24.14.0
curl --fail --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/$node_version/node-$node_version-linux-x64.tar.xz" -o "$out/node.tar.xz"
curl --fail --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/$node_version/SHASUMS256.txt" -o "$out/node-checksums.txt"
node_hash=$(awk -v file="node-$node_version-linux-x64.tar.xz" '$2 == file {print $1}' "$out/node-checksums.txt")
[[ $node_hash =~ ^[a-f0-9]{64}$ ]]
printf '%s  %s\n' "$node_hash" "$out/node.tar.xz" | sha256sum --check --status
tar -xJf "$out/node.tar.xz" --strip-components=1 -C "$root/usr/local"
cp vm-runner/guest-agent.mjs "$root/opt/judge/guest-agent.mjs"
cp vm-runner/init.sh "$root/opt/judge/init.sh"
chmod 0755 "$root/opt/judge/init.sh"
cp runner/package.json runner/package-lock.json "$root/opt/judge/"
# This installs only the trusted image's pinned lockfile, never participant packages.
chroot "$root" /usr/local/bin/npm ci --prefix /opt/judge --ignore-scripts --omit=dev
printf '%s\n' 'MODULES=dep' > "$root/etc/initramfs-tools/conf.d/judge"
printf '%s\n' ext4 virtio_blk virtio_pci virtio_net qemu_fw_cfg >> "$root/etc/initramfs-tools/modules"
chroot "$root" update-initramfs -u -k all
cp "$root"/boot/vmlinuz-* "$out/kernel"
cp "$root"/boot/initrd.img-* "$out/initrd"
chmod -R go-w "$root/opt/judge" "$root/usr/local"
sync
umount "$root"
chmod 0444 "$out/root.raw" "$out/kernel" "$out/initrd"
echo 'Prepared immutable guest files; record their composite digest before creating contracts.'
