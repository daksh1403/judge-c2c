#!/bin/sh
# PID1: no login service, SSH, package installation or writable root.
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev || true
mount -t tmpfs -o size=64m,nosuid,nodev,uid=65534,gid=65534,mode=0755 tmpfs /work
mount -t tmpfs -o size=64m,nosuid,nodev,noexec,mode=1777 tmpfs /tmp
mount -t tmpfs -o size=8m,nosuid,nodev,noexec,mode=0755 tmpfs /run
modprobe qemu_fw_cfg
modprobe virtio_net
modprobe virtio_rng
ip link set lo up
ip link set eth0 up
ip addr add 10.0.2.15/24 dev eth0
# No default route. QEMU additionally rejects outbound packets.
chmod 0600 /dev/ttyS0
/usr/local/bin/node /opt/judge/guest-agent.mjs > /dev/ttyS0 2>/dev/ttyS0
sleep 120
poweroff -f
