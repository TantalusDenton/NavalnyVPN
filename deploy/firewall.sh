#!/usr/bin/env bash
set -euo pipefail
wan=$(ip -4 route show default | awk 'NR==1 {print $5}')
[ -n "$wan" ]
# Isolate VPN users from the VPC, host services, metadata credentials and each other.
iptables -N NV-INPUT 2>/dev/null || true
iptables -F NV-INPUT
iptables -A NV-INPUT -i tun0 -p udp --dport 53 -j ACCEPT
iptables -A NV-INPUT -i tun0 -p tcp --dport 53 -j ACCEPT
iptables -A NV-INPUT -i tun0 -j DROP
iptables -A NV-INPUT -i "$wan" -p udp --dport 53 -j DROP
iptables -A NV-INPUT -i "$wan" -p tcp -m multiport --dports 53,8080 -j DROP
iptables -A NV-INPUT -j RETURN
iptables -C INPUT -j NV-INPUT 2>/dev/null || iptables -I INPUT 1 -j NV-INPUT
iptables -N NV-FORWARD 2>/dev/null || true
iptables -F NV-FORWARD
iptables -A NV-FORWARD -i tun0 -o tun0 -j DROP
for cidr in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 224.0.0.0/4 240.0.0.0/4; do
  iptables -A NV-FORWARD -i tun0 -d "$cidr" -j DROP
done
iptables -A NV-FORWARD -i tun0 -p tcp --dport 853 -j REJECT
iptables -A NV-FORWARD -i tun0 -p udp --dport 853 -j REJECT
iptables -A NV-FORWARD -i tun0 -o "$wan" -j ACCEPT
iptables -A NV-FORWARD -i "$wan" -o tun0 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A NV-FORWARD -o tun0 -j DROP
iptables -A NV-FORWARD -j RETURN
iptables -C FORWARD -j NV-FORWARD 2>/dev/null || iptables -I FORWARD 1 -j NV-FORWARD
iptables -t nat -C POSTROUTING -s 10.8.0.0/24 -o "$wan" -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o "$wan" -j MASQUERADE
for protocol in udp tcp; do
  iptables -t nat -C PREROUTING -i tun0 -p "$protocol" --dport 53 -j REDIRECT --to-ports 53 2>/dev/null || iptables -t nat -A PREROUTING -i tun0 -p "$protocol" --dport 53 -j REDIRECT --to-ports 53
done
ip6tables -C FORWARD -i tun0 -j DROP 2>/dev/null || ip6tables -I FORWARD 1 -i tun0 -j DROP
ip6tables -C INPUT -i tun0 -j DROP 2>/dev/null || ip6tables -I INPUT 1 -i tun0 -j DROP
