#!/usr/bin/env bash
set -euo pipefail
wan=$(ip -4 route show default | awk 'NR==1 {print $5}')
[ -n "$wan" ]
# Isolate VPN users from the VPC, host services, metadata credentials and each other.
iptables -N NV-INPUT 2>/dev/null || true
iptables -F NV-INPUT
for tunnel in tun0 tun1; do
  iptables -A NV-INPUT -i "$tunnel" -p udp --dport 53 -j ACCEPT
  iptables -A NV-INPUT -i "$tunnel" -p tcp --dport 53 -j ACCEPT
  iptables -A NV-INPUT -i "$tunnel" -j DROP
done
iptables -A NV-INPUT -i "$wan" -p udp --dport 53 -j DROP
iptables -A NV-INPUT -i "$wan" -p tcp -m multiport --dports 53,8080 -j DROP
iptables -A NV-INPUT -j RETURN
iptables -C INPUT -j NV-INPUT 2>/dev/null || iptables -I INPUT 1 -j NV-INPUT

iptables -N NV-FORWARD 2>/dev/null || true
iptables -F NV-FORWARD
iptables -A NV-FORWARD -i tun0 -o tun0 -j DROP
iptables -A NV-FORWARD -i tun1 -o tun1 -j DROP
iptables -A NV-FORWARD -i tun0 -o tun1 -j DROP
iptables -A NV-FORWARD -i tun1 -o tun0 -j DROP
for cidr in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 224.0.0.0/4 240.0.0.0/4; do
  iptables -A NV-FORWARD -i tun0 -d "$cidr" -j DROP
  iptables -A NV-FORWARD -i tun1 -d "$cidr" -j DROP
done
for tunnel in tun0 tun1; do
  iptables -A NV-FORWARD -i "$tunnel" -p tcp --dport 853 -j REJECT
  iptables -A NV-FORWARD -i "$tunnel" -p udp --dport 853 -j REJECT
  iptables -A NV-FORWARD -i "$tunnel" -o "$wan" -j ACCEPT
  iptables -A NV-FORWARD -i "$wan" -o "$tunnel" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  iptables -A NV-FORWARD -o "$tunnel" -j DROP
done
iptables -A NV-FORWARD -j RETURN
iptables -C FORWARD -j NV-FORWARD 2>/dev/null || iptables -I FORWARD 1 -j NV-FORWARD

for pool in 10.8.0.0/24 10.9.0.0/24; do
  iptables -t nat -C POSTROUTING -s "$pool" -o "$wan" -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s "$pool" -o "$wan" -j MASQUERADE
done
for tunnel in tun0 tun1; do
  for protocol in udp tcp; do
    iptables -t nat -C PREROUTING -i "$tunnel" -p "$protocol" --dport 53 -j REDIRECT --to-ports 53 2>/dev/null || iptables -t nat -A PREROUTING -i "$tunnel" -p "$protocol" --dport 53 -j REDIRECT --to-ports 53
  done
  ip6tables -C FORWARD -i "$tunnel" -j DROP 2>/dev/null || ip6tables -I FORWARD 1 -i "$tunnel" -j DROP
  ip6tables -C INPUT -i "$tunnel" -j DROP 2>/dev/null || ip6tables -I INPUT 1 -i "$tunnel" -j DROP
done
