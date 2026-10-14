#!/usr/bin/env bash
set -euo pipefail
# Only an explicitly attached EBS volume may be formatted.
volume_id=$(python3 -c 'import json; print(json.load(open("/etc/navalnyvpn/node.json"))["volumeId"])')
serial=$(printf '%s' "$volume_id" | tr -d '-')
disk=""
for attempt in $(seq 1 180); do
  for candidate in "/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_$serial" /dev/xvdf /dev/sdf; do
    if [ -b "$candidate" ]; then disk=$(readlink -f "$candidate"); break; fi
  done
  [ -n "$disk" ] && break
  sleep 2
done
[ -n "$disk" ] || { echo "Data volume did not attach" >&2; exit 1; }
root_device=$(findmnt -n -o SOURCE /)
[[ "$root_device" != "$disk"* ]] || { echo "Refusing to format root device" >&2; exit 1; }
filesystem=$(blkid -s TYPE -o value "$disk" || true)
if [ -z "$filesystem" ]; then
  [ -z "$(wipefs -n "$disk" -o TYPE --noheadings)" ] || { echo "Unknown disk signature" >&2; exit 1; }
  mkfs.ext4 -L navalny-data "$disk"
elif [ "$filesystem" != ext4 ]; then
  echo "Unexpected data filesystem" >&2; exit 1
fi
mkdir -p /var/lib/navalnyvpn
uuid=$(blkid -s UUID -o value "$disk")
grep -q "UUID=$uuid " /etc/fstab || printf 'UUID=%s /var/lib/navalnyvpn ext4 defaults,nofail 0 2\n' "$uuid" >> /etc/fstab
mountpoint -q /var/lib/navalnyvpn || mount /var/lib/navalnyvpn
chmod 700 /var/lib/navalnyvpn
