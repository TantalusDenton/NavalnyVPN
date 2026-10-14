FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends openvpn easy-rsa openssl jq python3 iproute2 dnsutils ca-certificates && rm -rf /var/lib/apt/lists/*
COPY deploy /workspace/deploy
COPY test/gateway-integration.sh /workspace/test/gateway-integration.sh
CMD ["bash", "/workspace/test/gateway-integration.sh"]
