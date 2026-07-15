ARG BASE_IMAGE=kalilinux/kali-rolling:latest
FROM ${BASE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive

RUN printf '%s\n' \
      'deb https://kali.download/kali kali-rolling main contrib non-free non-free-firmware' \
      > /etc/apt/sources.list \
    && rm -f /etc/apt/sources.list.d/* 2>/dev/null || true \
    && apt-get \
         -o Acquire::Retries=5 \
         -o Acquire::https::Timeout=30 \
         -o Acquire::https::Verify-Peer=false \
         -o Acquire::https::Verify-Host=false \
         update \
    && apt-get \
         -o Acquire::https::Verify-Peer=false \
         -o Acquire::https::Verify-Host=false \
         install -y --no-install-recommends ca-certificates \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        systemd \
        systemd-sysv \
        dbus \
        sudo \
        openssh-server \
        curl \
        iproute2 \
        iputils-ping \
        bash \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN echo 'root:root' | chpasswd \
    && mkdir -p /etc/ssh/sshd_config.d /var/run/sshd \
    && printf '%s\n' \
        'PermitRootLogin yes' \
        'PasswordAuthentication yes' \
        'UsePAM yes' \
        'UseDNS no' \
        'AllowTcpForwarding yes' \
        'AllowStreamLocalForwarding yes' \
        > /etc/ssh/sshd_config.d/99-edi-containers.conf \
    && systemctl enable ssh.service \
    && systemctl disable ssh.socket || true \
    && update-rc.d ssh enable 2>/dev/null || true

CMD ["/lib/systemd/systemd"]
